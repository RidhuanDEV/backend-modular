import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
export class CreatePermissionDto {
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
}
export class UpdatePermissionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
}
export class PermissionResponseDto {
  id!: string;
  name!: string;
  createdAt!: string;
  updatedAt!: string;
}
