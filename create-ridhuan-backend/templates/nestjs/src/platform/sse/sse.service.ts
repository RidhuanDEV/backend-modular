import { Injectable, type MessageEvent } from "@nestjs/common";
import { filter, map, Observable, Subject } from "rxjs";

interface EventEnvelope {
  channel: string;
  id: string;
  data: Record<string, unknown>;
}
@Injectable()
export class SseBroker {
  private readonly stream = new Subject<EventEnvelope>();
  publish(event: EventEnvelope): void {
    this.stream.next(event);
  }
  subscribe(channel: string): Observable<MessageEvent> {
    return this.stream.pipe(
      filter((event) => event.channel === channel),
      map((event) => ({ id: event.id, data: event.data })),
    );
  }
}
