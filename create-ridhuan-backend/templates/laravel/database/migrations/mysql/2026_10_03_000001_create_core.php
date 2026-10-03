<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('roles', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->string('name', 64)->unique();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('permissions', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->string('name', 128)->unique();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('role_permissions', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->foreignUuid('role_id')->constrained('roles')->cascadeOnDelete();
            $t->foreignUuid('permission_id')->constrained('permissions')->cascadeOnDelete();
            $t->primary(['role_id', 'permission_id']);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('users', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->string('email')->unique();
            $t->string('password');
            $t->foreignUuid('role_id')->constrained('roles')->restrictOnDelete();
            $t->dateTime('deleted_at', 6)->nullable();
            $t->index('role_id');
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('stored_files', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->string('storage', 16);
            $t->string('status', 16)->default('READY');
            $t->string('object_key')->unique();
            $t->string('original_name');
            $t->string('mime_type', 128);
            $t->integer('size');
            $t->foreignUuid('uploader_id')->nullable()->constrained('users')->nullOnDelete();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('activity_logs', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->string('behavior', 64);
            $t->string('module', 64);
            $t->uuid('entity_id')->nullable();
            $t->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $t->uuid('actor_id_snapshot')->nullable();
            $t->json('before')->nullable();
            $t->json('after')->nullable();
            $t->string('request_id', 64)->nullable();
            $t->string('endpoint_id', 128)->nullable();
            $t->index(['endpoint_id', 'created_at']);
            $t->index(['module', 'entity_id', 'created_at']);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('refresh_tokens', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->uuid('family_id')->index();
            $t->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $t->string('token_hash', 64)->unique();
            $t->dateTime('expires_at', 6);
            $t->dateTime('consumed_at', 6)->nullable();
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
        Schema::create('notifications', function (Blueprint $t): void {
            $t->engine = 'InnoDB';
            $t->charset = 'utf8mb4';
            $t->collation = 'utf8mb4_unicode_ci';
            $t->uuid('id')->primary();
            $t->foreignUuid('recipient_id')->constrained('users')->cascadeOnDelete();
            $t->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $t->string('title', 160);
            $t->text('body');
            $t->string('email_status', 16)->default('NOT_REQUESTED');
            $t->dateTime('read_at', 6)->nullable();
            $t->index(['recipient_id', 'created_at', 'id']);
            $t->dateTime('created_at', 6);
            $t->dateTime('updated_at', 6);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('refresh_tokens');
        Schema::dropIfExists('activity_logs');
        Schema::dropIfExists('stored_files');
        Schema::dropIfExists('users');
        Schema::dropIfExists('role_permissions');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('roles');
    }
};
