import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminAuthGuard, type AdminRequest } from './admin-auth.guard.js';
import {
  CreateTaxonomyItemDto,
  RenameTaxonomyItemDto,
  SetAvailabilityDto,
  SetEnabledDto,
} from './dto/taxonomy.dto.js';
import {
  TaxonomyService,
  type AvailabilityEntry,
  type TaxonomyItem,
  type TaxonomySnapshot,
} from './taxonomy.service.js';

@Controller('admin/taxonomy')
@UseGuards(AdminAuthGuard)
@SkipThrottle({ login: true })
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  list(): Promise<TaxonomySnapshot> {
    return this.taxonomy.listTaxonomy();
  }

  @Get('grade-levels/:id/selectable-subjects')
  selectableSubjects(@Param('id', ParseUUIDPipe) id: string): Promise<TaxonomyItem[]> {
    return this.taxonomy.listSelectableSubjects(id);
  }

  @Get('subjects/:id')
  resolveSubject(@Param('id', ParseUUIDPipe) id: string): Promise<TaxonomyItem> {
    return this.taxonomy.resolveSubject(id);
  }

  @Get('grade-levels/:id')
  resolveGradeLevel(@Param('id', ParseUUIDPipe) id: string): Promise<TaxonomyItem> {
    return this.taxonomy.resolveGradeLevel(id);
  }

  @Post('subjects')
  createSubject(
    @Req() req: AdminRequest,
    @Body() dto: CreateTaxonomyItemDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.createSubject(actor(req), dto.name);
  }

  @Patch('subjects/:id/name')
  renameSubject(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.renameSubject(actor(req), id, dto.name);
  }

  @Patch('subjects/:id/enabled')
  setSubjectEnabled(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEnabledDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.setSubjectEnabled(actor(req), id, dto.enabled);
  }

  @Post('grade-levels')
  createGradeLevel(
    @Req() req: AdminRequest,
    @Body() dto: CreateTaxonomyItemDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.createGradeLevel(actor(req), dto.name);
  }

  @Patch('grade-levels/:id/name')
  renameGradeLevel(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.renameGradeLevel(actor(req), id, dto.name);
  }

  @Patch('grade-levels/:id/enabled')
  setGradeLevelEnabled(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEnabledDto,
  ): Promise<TaxonomyItem> {
    return this.taxonomy.setGradeLevelEnabled(actor(req), id, dto.enabled);
  }

  @Put('availability')
  setAvailability(
    @Req() req: AdminRequest,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilityEntry> {
    return this.taxonomy.setAvailability(actor(req), dto.subjectId, dto.gradeLevelId, dto.enabled);
  }
}

function actor(req: AdminRequest): string {
  return req.admin!.adminUserId;
}
