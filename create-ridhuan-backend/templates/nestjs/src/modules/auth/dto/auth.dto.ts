import { IsEmail, IsString, MinLength, MaxLength } from "class-validator";
import { MaxUtf8Bytes } from "../../../common/dto/password";

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(128) @MaxUtf8Bytes(72) password!: string;
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
