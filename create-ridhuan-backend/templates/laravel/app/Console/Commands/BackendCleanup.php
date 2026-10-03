<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Infrastructure\RateLimit\FileQuotaCleaner;
use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Uploads\Models\StoredFile;
use App\Support\Config\Settings;
use App\Support\Observability\Telemetry;
use App\Support\Time\Clock;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class BackendCleanup extends Command
{
    protected $signature = 'backend:cleanup {--apply} {--dry-run}';

    protected $description = 'Bounded retention/orphan cleanup; dry-run by default';

    public function handle(Clock $clock, Telemetry $telemetry): int
    {
        if (
            $this->option('apply') === true &&
            $this->option('dry-run') === true
        ) {
            $this->error('Choose apply or dry-run');

            return self::FAILURE;
        }
        Settings::validate();
        $apply = $this->option('apply') === true;
        $limit = Settings::integer('backend.cleanup.batch', 1, 10000);
        $cutoff = $clock
            ->now()
            ->subDays(Settings::integer('backend.cleanup.days', 1));
        $scope = $telemetry->start('cleanup.run');
        $started = microtime(true);
        try {
            $counts = DB::transaction(function () use (
                $apply,
                $limit,
                $cutoff,
            ): array {
                $families = RefreshFamily::query()
                    ->where(
                        fn($q) => $q
                            ->where('expires_at', '<', $cutoff)
                            ->orWhere('revoked_at', '<', $cutoff),
                    )
                    ->orderBy('id')
                    ->limit($limit)
                    ->lock('FOR UPDATE SKIP LOCKED')
                    ->get();
                $jobs = EmailJob::query()
                    ->whereIn('status', ['SENT', 'FAILED'])
                    ->where('completed_at', '<', $cutoff)
                    ->whereNull('lease_id')
                    ->orderBy('id')
                    ->limit($limit)
                    ->lock('FOR UPDATE SKIP LOCKED')
                    ->get();
                if ($apply) {
                    foreach ($families as $family) {
                        $family->delete();
                    }
                    foreach ($jobs as $job) {
                        $job->delete();
                    }
                }
                $auditCount = 0;
                if (Settings::boolean('backend.cleanup.audit')) {
                    $ids = DB::table('activity_logs')
                        ->where(
                            'created_at',
                            '<',
                            now('UTC')->subDays(
                                Settings::integer(
                                    'backend.cleanup.auditDays',
                                    1,
                                ),
                            ),
                        )
                        ->orderBy('id')
                        ->limit($limit)
                        ->lock('FOR UPDATE SKIP LOCKED')
                        ->pluck('id');
                    $auditCount = $ids->count();
                    if ($apply) {
                        DB::table('activity_logs')
                            ->whereIn('id', $ids)
                            ->delete();
                    }
                }

                return [
                    'families' => $families->count(),
                    'jobs' => $jobs->count(),
                    'audit' => $auditCount,
                ];
            });
            $diskName = Settings::string('backend.upload.disk');
            if (!in_array($diskName, ['local', 's3'], true)) {
                throw new \RuntimeException('Invalid storage adapter');
            }
            $disk = Storage::disk($diskName);
            $orphanCount = 0;
            $scanned = 0;
            $grace = $clock
                ->now()
                ->subHours(Settings::integer('backend.cleanup.uploadHours', 1))
                ->getTimestamp();
            foreach ($disk->getDriver()->listContents('', true) as $entry) {
                if (++$scanned > 10000 || $orphanCount >= $limit) {
                    break;
                }
                $key = $entry->path();
                if (
                    !$entry->isFile() ||
                    !preg_match('/^[0-9a-f-]{36}\.(png|jpg|pdf)$/D', $key) ||
                    !Str::isUuid(pathinfo($key, PATHINFO_FILENAME)) ||
                    $disk->lastModified($key) >= $grace
                ) {
                    continue;
                }
                if ($diskName === 'local' && is_link($disk->path($key))) {
                    continue;
                }
                if (
                    StoredFile::query()
                        ->where('storage', $diskName)
                        ->where('object_key', $key)
                        ->exists()
                ) {
                    continue;
                }
                $orphanCount++;
                if ($apply && $this->unreferenced($diskName, $key)) {
                    $disk->delete($key);
                }
            }
            $quotaCount = app(FileQuotaCleaner::class)->clean($apply, $limit);
            foreach ($counts as $kind => $count) {
                $telemetry->event(
                    ($apply ? 'cleanup.deleted.' : 'cleanup.candidates.') .
                        $kind,
                    $count,
                );
            }
            $telemetry->event('cleanup.orphan_candidates', $orphanCount);
            $telemetry->event('cleanup.expired_quota_candidates', $quotaCount);
            $this->line(
                json_encode(
                    [
                        'apply' => $apply,
                        ...$counts,
                        'orphans' => $orphanCount,
                        'expiredQuotaBuckets' => $quotaCount,
                    ],
                    JSON_THROW_ON_ERROR,
                ),
            );
        } finally {
            $telemetry->finish(
                $scope,
                'cleanup.run',
                200,
                microtime(true) - $started,
            );
        }

        return self::SUCCESS;
    }

    /** @phpstan-impure */
    private function unreferenced(string $disk, string $key): bool
    {
        return !StoredFile::query()
            ->where('storage', $disk)
            ->where('object_key', $key)
            ->exists();
    }
}
