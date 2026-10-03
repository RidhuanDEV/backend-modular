import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { command } from "../dist/process.js";
import { collectProcessCase } from "./hardening-process.mjs";
import { cleanupHardeningFixtures } from "./hardening-fixture-cleanup.mjs";

test("failed child is collected; independent following child still executes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hardening-runner-unit-"));
  try {
    const first = await collectProcessCase(
      {
        executable: process.execPath,
        args: [
          "-e",
          "console.error('controlled unit failure');process.exitCode=7",
        ],
        cwd: directory,
      },
      join(directory, "failure.log"),
      process.env,
    );
    assert.equal(first.exitCode, 7);
    const second = await collectProcessCase(
      {
        executable: process.execPath,
        args: ["-e", "console.log('following case executed')"],
        cwd: directory,
      },
      join(directory, "success.log"),
      process.env,
    );
    assert.equal(second.exitCode, 0);
    assert.match(
      await readFile(join(directory, "success.log"), "utf8"),
      /following case executed/,
    );
  } finally {
    assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "cleanup is scoped to recorded case and preserves another active stage",
  { skip: !process.argv.includes("--docker") },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "hardening-cleanup-unit-"));
    const owners = [
      "acceptance-api-" + randomUUID().slice(0, 8),
      "acceptance-api-" + randomUUID().slice(0, 8),
    ];
    const names = owners.map((owner) => owner + "-scope-proof");
    const volumes = owners.map((owner) => owner + "-scope-volume");
    function docker(args) {
      return command("docker", args, directory);
    }
    try {
      for (let index = 0; index < owners.length; index++) {
        assert.equal(
          docker([
            "volume",
            "create",
            "--label",
            `com.docker.compose.project=${owners[index]}`,
            volumes[index],
          ]).status,
          0,
        );
        assert.equal(
          docker([
            "run",
            "-d",
            "--name",
            names[index],
            "--label",
            `com.docker.compose.project=${owners[index]}`,
            "--label",
            `com.docker.compose.project.working_dir=${join(tmpdir(), "ridhuan golang compose-scopeProof", "acceptance-api")}`,
            "-v",
            `${volumes[index]}:/scope`,
            "--entrypoint",
            "sh",
            "postgres:18.3-alpine",
            "-c",
            "sleep 300",
          ]).status,
          0,
        );
      }
      await writeFile(join(directory, "hardening-scope.log"), owners[0]);
      const result = await cleanupHardeningFixtures(directory);
      assert.deepEqual(result.failures, []);
      assert.equal(result.removed.containers, 1);
      assert.equal(result.removed.volumes, 1);
      assert.notEqual(docker(["inspect", names[0]]).status, 0);
      assert.equal(
        docker(["inspect", names[1]]).status,
        0,
        "Unrelated active stage was removed",
      );
      assert.equal(docker(["volume", "inspect", volumes[1]]).status, 0);
    } finally {
      for (const name of names)
        if (docker(["inspect", name]).status === 0)
          assert.equal(docker(["rm", "-f", "-v", name]).status, 0);
      for (const volume of volumes)
        if (docker(["volume", "inspect", volume]).status === 0)
          assert.equal(docker(["volume", "rm", volume]).status, 0);
      assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("timeout and cancellation produce failures while the runner continues",async()=>{const directory=await mkdtemp(join(tmpdir(),"hardening-runner-timeout-"));try{const result=await collectProcessCase({executable:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:directory},join(directory,"timeout.log"),process.env,100);assert.equal(result.exitCode,124);const controller=new AbortController();setTimeout(()=>controller.abort(),100);const aborted=await collectProcessCase({executable:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:directory,signal:controller.signal},join(directory,"abort.log"),process.env,10000);assert.equal(aborted.exitCode,130);}finally{assert(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}});

test("invalid log path is a collected failure and does not launch its child",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"hardening-log-error-"));
 try{
  const marker=join(directory,"must-not-exist");
  const result=await collectProcessCase({executable:process.execPath,args:["-e","require('fs').writeFileSync(process.argv[1],'launched')",marker],cwd:directory},join(directory,"missing","log"),process.env);
  assert.equal(result.exitCode,1);assert.match(result.error,/Cannot open task log/);
  await assert.rejects(readFile(marker),{code:"ENOENT"});
 }finally{assert(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true});}
});
