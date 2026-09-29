import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
  @IsUUID() roleId!: string;
}
export class UpdateUserDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsUUID() roleId?: string;
}
export class UserResponseDto {
  id!: string; email!: string; roleId!: string;
  role!: { id: string; name: string; permissions: { id: string; name: string }[] };
  createdAt!: string; updatedAt!: string;
}
