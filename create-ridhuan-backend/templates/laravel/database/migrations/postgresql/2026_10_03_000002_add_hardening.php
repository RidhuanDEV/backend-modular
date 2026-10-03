<?php

declare(strict_types=1);

use App\Infrastructure\Database\HardeningBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('refresh_families', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $t->timestampTz('expires_at', 6);
            $t->timestampTz('revoked_at', 6)->nullable();
            $t->index(['expires_at', 'revoked_at']);
            $t->timestampTz('created_at', 6);
            $t->timestampTz('updated_at', 6);
        });
        Schema::table('notifications', function (Blueprint $t): void {
            $t->bigInteger('sequence')->nullable();
        });
        Schema::create('notification_counters', function (Blueprint $t): void {
            $t->foreignUuid('recipient_id')->primary()->constrained('users')->cascadeOnDelete();
            $t->bigInteger('sequence')->default(0);
            $t->timestampTz('created_at', 6);
            $t->timestampTz('updated_at', 6);
        });
        Schema::create('email_jobs', function (Blueprint $t): void {
            $t->uuid('id')->primary();
            $t->foreignUuid('notification_id')->unique()->constrained('notifications')->cascadeOnDelete();
            $t->string('recipient');
            $t->string('title', 160);
            $t->text('body');
            $t->string('status', 16)->default('PENDING');
            $t->integer('attempts')->default(0);
            $t->timestampTz('available_at', 6);
            $t->uuid('lease_id')->nullable();
            $t->timestampTz('lease_until', 6)->nullable();
            $t->timestampTz('completed_at', 6)->nullable();
            $t->index(['status', 'available_at', 'lease_until']);
            $t->timestampTz('created_at', 6);
            $t->timestampTz('updated_at', 6);
        });
        HardeningBackfill::run();
        Schema::table('refresh_tokens', function (Blueprint $t): void {
            $t->foreign('family_id')->references('id')->on('refresh_families')->cascadeOnDelete();
        });
        Schema::table('notifications', function (Blueprint $t): void {
            $t->bigInteger('sequence')->nullable(false)->change();
            $t->unique(['recipient_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_jobs');
        Schema::dropIfExists('notification_counters');
        Schema::table('notifications', function (Blueprint $t): void {
            $t->dropUnique(['recipient_id', 'sequence']);
            $t->dropColumn('sequence');
        });
        Schema::table('refresh_tokens', function (Blueprint $t): void {
            $t->dropForeign(['family_id']);
        });
        Schema::dropIfExists('refresh_families');
    }
};
