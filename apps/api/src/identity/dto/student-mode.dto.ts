import { IsUUID } from 'class-validator';

/**
 * The deliberate exit from Parent View names the child the device is handed to.
 *
 * The id is required and must be a UUID: a malformed id is a client bug, and
 * refusing it at the edge keeps the 404 below meaning exactly one thing — the
 * profile is not one this account may bind to.
 */
export class BindStudentModeDto {
  @IsUUID()
  studentProfileId!: string;
}
