import { Module } from "@nestjs/common";
import { SseBroker } from "./sse.service";
@Module({ providers: [SseBroker], exports: [SseBroker] }) export class SseModule {}
