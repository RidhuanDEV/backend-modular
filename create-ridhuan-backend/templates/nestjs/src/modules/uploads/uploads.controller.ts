import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Express } from "express";
import { CurrentActor } from "../../common/auth/current-actor.decorator";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import type { Actor, ApiRequest } from "../../common/http/request-context";
import { success, type Success } from "../../common/http/response";
import { UploadResponseDto } from "./dto/upload.dto";
import { UploadsService } from "./uploads.service";

@ApiTags("upload") @ApiBearerAuth() @Controller("api/upload")
export class UploadsController {
  constructor(private readonly service: UploadsService) {}
  @Post() @Endpoint("upload.create") @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data") @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  async create(@UploadedFile() file: Express.Multer.File | undefined, @CurrentActor() actor: Actor, @Req() req: ApiRequest): Promise<Success<UploadResponseDto>> {
    return success(await this.service.create(file, actor, req.requestId));
  }
  @Get(":id") @Endpoint("upload.get")
  async get(@Param("id", ParseUUIDPipe) id: string, @CurrentActor() actor: Actor): Promise<Success<UploadResponseDto>> { return success(await this.service.get(id, actor)); }
}
