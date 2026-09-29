import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateNotificationDto {
  @IsUUID() recipientId!: string;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}

export class NotificationResponseDto {
  id!: string;
  recipientId!: string;
  title!: string;
  body!: string;
  emailStatus!: "NOT_REQUESTED" | "PENDING" | "SENT" | "FAILED";
  readAt!: string | null;
  createdAt!: string;
}
