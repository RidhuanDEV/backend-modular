import { IsEmail, IsString, MinLength, MaxLength } from "class-validator";

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

export class RefreshDto {
  @IsString() @MinLength(1) refreshToken!: string;
}

export class AuthUserResponseDto {
  id!: string;
  email!: string;
  roleId!: string;
  createdAt!: string;
  updatedAt!: string;
}

export class AuthResponseDto {
  token!: string;
  refreshToken!: string;
}
