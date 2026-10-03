import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

let app: INestApplication;
let s3: S3Client;
before(async () => {
  process.env.UPLOAD_STORAGE = "s3";
  process.env.S3_ENDPOINT ??= "http://127.0.0.1:9000";
  process.env.S3_REGION ??= "us-east-1";
  process.env.S3_BUCKET ??= "uploads";
  process.env.S3_ACCESS_KEY_ID ??= "minioadmin";
  process.env.S3_SECRET_ACCESS_KEY ??= "minioadmin";
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "BucketAlreadyOwnedByYou")
      throw error;
  }
  const { createApp } = await import("../main");
  app = await createApp();
});
after(async () => {
  if (app) await app.close();
  if (s3) s3.destroy();
});

test("S3 upload stores metadata through MinIO", async () => {
  const login = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
  assert.equal(login.status, 200);
  const body = login.body as { data: { token: string } };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await request(app.getHttpServer())
    .post("/api/upload")
    .set("Authorization", `Bearer ${body.data.token}`)
    .attach("file", png, { filename: "dot.png", contentType: "image/png" });
  assert.equal(uploaded.status, 201);
  assert.equal(
    (uploaded.body as { data: { storage: string } }).data.storage,
    "s3",
  );
});
