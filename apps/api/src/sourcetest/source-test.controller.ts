import {
  type ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { MulterError, memoryStorage } from 'multer';
import { ParentElevationGuard, type ElevatedRequest } from '../identity/parent-elevation.guard.js';
import type { TaxonomyItem } from '../admin/taxonomy.service.js';
import {
  ClassifySourceTestDto,
  OpenSourceTestDto,
  ReorderPagesDto,
} from './dto/source-test.dto.js';
import { UNSUPPORTED_IMAGE_FORMAT, maxPageBytes, pageTooLarge } from './source-test-policy.js';
import { SourceTestService, type SourceTestView } from './source-test.service.js';

/**
 * The multipart configuration both byte-carrying routes share.
 *
 * `memoryStorage` on purpose: multer's disk storage picks the filename and the
 * directory itself, which would put a path outside this module's control and
 * defeat AD-15's whole point — the path is derived from the row id, by the one
 * function that derives it. The bytes reach `PageIngestService` as a buffer and
 * are written exactly once, where the row says.
 *
 * `fileSize` is a getter rather than a value. A decorator argument is evaluated
 * while the module is being imported — before `SourceTestModule`'s constructor
 * has resolved the runtime — so a plain `maxPageBytes()` here would freeze
 * whatever the environment happened to say at import time, and a test that
 * overrides the ceiling would be overriding nothing. Multer reads `limits`
 * afresh for each request it parses, so the getter is evaluated then.
 */
function pageUpload() {
  return FileInterceptor('file', {
    storage: memoryStorage(),
    limits: {
      files: 1,
      get fileSize() {
        return maxPageBytes();
      },
    },
  });
}

/**
 * The exact strings `@nestjs/platform-express`'s own multer/busboy error
 * translation produces (see its `multer.utils.js#transformException`) for
 * every non-size failure — "Unexpected field", "Too many files", and so on,
 * each optionally suffixed with `" - <field>"`. Matched by prefix so this
 * module's own `BadRequestException(UNSUPPORTED_IMAGE_FORMAT)` — and
 * `ParseUUIDPipe`'s unrelated "Validation failed (uuid is expected)" on the
 * same routes — never collide with it.
 */
const MULTER_TRANSFORMED_MESSAGES = [
  'Too many parts',
  'Too many files',
  'Field name too long',
  'Field value too long',
  'Too many fields',
  'Unexpected field',
  'Field name missing',
  'Field name nesting too deep',
] as const;

function isMulterTransformedBadRequest(error: BadRequestException): boolean {
  const body = error.getResponse();
  const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    MULTER_TRANSFORMED_MESSAGES.some((prefix) => message.startsWith(prefix))
  );
}

/**
 * Restates the multipart layer's refusal in this module's own words.
 *
 * `@nestjs/platform-express` already turns every multer failure into a Nest
 * exception before it ever reaches a filter: `LIMIT_FILE_SIZE` becomes a
 * `PayloadTooLargeException` (413), and every other multer/busboy code —
 * wrong field name, too many files, and so on — becomes a plain
 * `BadRequestException` carrying multer's own message verbatim, including the
 * offending field name. Both leak the framework's words to a parent holding a
 * photograph, so both are restated here. `MulterError` is still caught
 * alongside them in case a future platform version stops pre-translating.
 */
@Catch(PayloadTooLargeException, BadRequestException, MulterError)
class MulterFailureFilter implements ExceptionFilter {
  catch(
    error: PayloadTooLargeException | BadRequestException | MulterError,
    host: ArgumentsHost,
  ): void {
    const translated = this.translate(error);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(translated.getStatus()).json(translated.getResponse());
  }

  private translate(
    error: PayloadTooLargeException | BadRequestException | MulterError,
  ): PayloadTooLargeException | BadRequestException {
    if (error instanceof PayloadTooLargeException)
      return new PayloadTooLargeException(pageTooLarge());
    if (error instanceof MulterError) {
      return error.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException(pageTooLarge())
        : new BadRequestException(UNSUPPORTED_IMAGE_FORMAT);
    }
    // Our own `requireBytes` refusal and `ParseUUIDPipe`'s validation failure
    // both arrive as a `BadRequestException` too; neither is a multer message,
    // so both pass through exactly as thrown.
    return isMulterTransformedBadRequest(error)
      ? new BadRequestException(UNSUPPORTED_IMAGE_FORMAT)
      : error;
  }
}

/**
 * Source Tests and their pages, mounted at `/api/parent/source-tests`.
 *
 * Every route is behind `ParentElevationGuard`, and the account is taken from
 * `req.elevated` and never from the path or the body (AD-18). A Source Test id
 * belonging to another account therefore matches nothing and answers 404 — the
 * guard's own refusal is the only 401 any of these can produce.
 *
 * No route runs argon2, so none is a `@ParentCredentialRoute()` and none spends
 * the credential throttler budget.
 */
@Controller('parent/source-tests')
@SkipThrottle({ login: true })
@UseGuards(ParentElevationGuard)
export class SourceTestController {
  constructor(private readonly sourceTests: SourceTestService) {}

  /** Opens the child's draft, or resumes the one already open. */
  @Post()
  @HttpCode(HttpStatus.OK)
  open(@Req() req: ElevatedRequest, @Body() dto: OpenSourceTestDto): Promise<SourceTestView> {
    return this.sourceTests.openDraft(req.elevated!.parentAccountId, dto.studentProfileId);
  }

  /**
   * The Subjects offered for a Grade Level.
   *
   * Declared **before** `@Get(':id')`, and that order is load-bearing for
   * exactly the reason `pages/order` is declared before `pages/:pageId`:
   * Express matches in declaration order, so `GET .../:id` would otherwise
   * swallow this path and `ParseUUIDPipe` would answer 400 about the literal
   * "subjects".
   *
   * It lives on this controller rather than at a free-standing
   * `/parent/subjects` because the Subject list exists in this product for one
   * purpose — classifying a Source Test — and is served by the module that
   * needs it, reading through `TaxonomyService`. `/parent/grade-levels` on
   * `StudentProfileController` is the same arrangement.
   */
  @Get('subjects')
  subjects(@Query('gradeLevelId', ParseUUIDPipe) gradeLevelId: string): Promise<TaxonomyItem[]> {
    return this.sourceTests.listSubjectsFor(gradeLevelId);
  }

  @Get(':id')
  read(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SourceTestView> {
    return this.sourceTests.read(req.elevated!.parentAccountId, id);
  }

  /**
   * Appends one page.
   *
   * A plain file input is the only page-add affordance this story ships; the
   * camera viewfinder and the continuous-capture loop are Story 3.1's. This
   * route is what both of them will post to.
   */
  @Post(':id/pages')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(pageUpload())
  @UseFilters(MulterFailureFilter)
  addPage(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SourceTestView> {
    return this.sourceTests.addPage(req.elevated!.parentAccountId, id, requireBytes(file));
  }

  /**
   * The explicit permutation. It is a `PUT` on the order itself rather than a
   * move with a direction, so the wire format says what the order *is*.
   *
   * Declared **before** the retake route below, and that order is load-bearing:
   * Express matches in declaration order, so `PUT .../pages/:pageId` would
   * otherwise swallow this path with `pageId` bound to the literal "order".
   */
  @Put(':id/pages/order')
  reorderPages(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPagesDto,
  ): Promise<SourceTestView> {
    return this.sourceTests.reorderPages(req.elevated!.parentAccountId, id, dto.pageIds);
  }

  /** Replaces one page's bytes. Its ordinal and its siblings are untouched. */
  @Put(':id/pages/:pageId')
  @UseInterceptors(pageUpload())
  @UseFilters(MulterFailureFilter)
  retakePage(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SourceTestView> {
    return this.sourceTests.retakePage(
      req.elevated!.parentAccountId,
      id,
      pageId,
      requireBytes(file),
    );
  }

  /** Removes one page; the survivors renumber without their bytes being read. */
  @Delete(':id/pages/:pageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePage(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ): Promise<void> {
    return this.sourceTests.deletePage(req.elevated!.parentAccountId, id, pageId);
  }

  /**
   * Sets the Subject, the Grade Level, or both — validated as the one pair the
   * Source Test will hold afterwards, never field by field.
   */
  @Patch(':id/classification')
  classify(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClassifySourceTestDto,
  ): Promise<SourceTestView> {
    return this.sourceTests.classify(req.elevated!.parentAccountId, id, dto);
  }

  /**
   * Runs the one batch legibility check over every page, and answers with the
   * Source Test carrying the verdicts.
   *
   * No body: the page set *is* the request, and a body naming pages would be a
   * second place the batch's membership is decided. Foreground and in-request
   * by decision (AD-4) — the parent is still holding the paper, so the answer
   * has to arrive while a retake is still possible.
   *
   * It runs once. A second, sequential call answers with the stored result
   * and costs nothing. Two requests that race each other may each dispatch a
   * provider call before either sees the other's write — only the winner's
   * verdicts are stored, so a genuine double tap can still spend two provider
   * calls (tracked as a deferred cost-control gap, not a correctness one).
   */
  @Post(':id/legibility')
  @HttpCode(HttpStatus.OK)
  checkLegibility(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SourceTestView> {
    return this.sourceTests.checkLegibility(req.elevated!.parentAccountId, id);
  }

  /**
   * Refused server-side while zero pages remain, either half of the
   * classification is unset, or the legibility check has not run — whatever
   * the client did.
   */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Req() req: ElevatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SourceTestView> {
    return this.sourceTests.submit(req.elevated!.parentAccountId, id);
  }
}

/**
 * A request that carried no file part at all.
 *
 * It answers the same message an unreadable one does: from the parent's side
 * both are "that is not a photo this can read", and distinguishing them would
 * only describe the wire format back to someone who cannot act on it.
 */
function requireBytes(file: Express.Multer.File | undefined): Buffer {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new BadRequestException(UNSUPPORTED_IMAGE_FORMAT);
  }
  return file.buffer;
}
