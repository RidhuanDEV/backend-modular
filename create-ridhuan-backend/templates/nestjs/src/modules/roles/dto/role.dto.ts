import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
}
export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
}
export class AssignPermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("all", { each: true })
  permissionIds!: string[];
}
export class RoleResponseDto {
  id!: string;
  name!: string;
  permissions!: { id: string; name: string }[];
  createdAt!: string;
  updatedAt!: string;
}
