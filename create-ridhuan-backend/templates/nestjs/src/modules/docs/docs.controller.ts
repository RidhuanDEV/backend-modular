import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiTags, type OpenAPIObject } from "@nestjs/swagger";
import { Endpoint } from "../../common/endpoint/endpoint.registry";
import { DocsService } from "./docs.service";

@ApiTags("docs")
@Controller("docs")
export class DocsController {
  constructor(private readonly docs: DocsService) {}
  @Get("specs/:module.json")
  @Endpoint("docs.moduleSpec")
  moduleSpec(@Param("module") module: string): OpenAPIObject {
    const result = this.docs.moduleSpec(module);
    if (!result) throw new NotFoundException("Module not found");
    return result;
  }
}
