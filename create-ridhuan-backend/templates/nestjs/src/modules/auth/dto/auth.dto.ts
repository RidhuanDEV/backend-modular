import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from "class-validator";
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
  // Optional so cookie mode can read the httpOnly cookie instead; the controller enforces presence.
  @IsOptional() @IsString() @MinLength(1) refreshToken?: string;
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
  /** Omitted when REFRESH_TOKEN_TRANSPORT=cookie (sent as an httpOnly cookie). */
  refreshToken?: string;
}

/** Both tokens as issued; the controller decides how the refresh token is transported. */
export interface IssuedTokens {
  token: string;
  refreshToken: string;
}
