import { BadRequestException } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(["asc", "desc"]) orderBy: "asc" | "desc" = "desc";
  @IsOptional() @IsString() sortBy = "createdAt";
  @IsOptional() @IsString() fields?: string;
}

export function fieldsAllowed(
  value: string | undefined,
  allow: readonly string[],
): readonly string[] | undefined {
  if (!value) return undefined;
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.some((field) => !allow.includes(field)))
    throw new BadRequestException("Unknown projection field");
  return fields;
}
