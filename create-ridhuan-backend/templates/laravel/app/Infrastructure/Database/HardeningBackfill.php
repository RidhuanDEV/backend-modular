<?php

declare(strict_types=1);

namespace App\Infrastructure\Database;

use Illuminate\Support\Facades\DB;
use RuntimeException;

final class HardeningBackfill
{
    public static function run(): void
    {
        DB::transaction(function (): void {
            $families = DB::table('refresh_tokens')->select('family_id')->distinct()->orderBy('family_id')->cursor();
            foreach ($families as $family) {
                if (! is_string($family->family_id)) {
                    throw new RuntimeException('Invalid legacy family');
                }
                $tokens = DB::table('refresh_tokens')->where('family_id', $family->family_id)->orderByDesc('expires_at')->get();
                $latest = $tokens->first();
                if ($latest === null) {
                    continue;
                }
                $users = $tokens->pluck('user_id')->unique();
                if ($users->count() !== 1) {
                    throw new RuntimeException('Legacy family has multiple users');
                }
                $hasLive = $tokens->contains(fn (object $token): bool => $token->consumed_at === null);
                DB::table('refresh_families')->insert(['id' => $family->family_id, 'user_id' => $latest->user_id, 'expires_at' => $latest->expires_at, 'revoked_at' => $hasLive ? null : $latest->consumed_at, 'created_at' => $tokens->min('created_at'), 'updated_at' => $latest->updated_at]);
            }
            foreach (DB::table('notifications')->select('recipient_id')->distinct()->orderBy('recipient_id')->cursor() as $recipient) {
                $sequence = 0;
                foreach (DB::table('notifications')->where('recipient_id', $recipient->recipient_id)->orderBy('created_at')->orderBy('id')->cursor() as $notification) {
                    DB::table('notifications')->where('id', $notification->id)->update(['sequence' => ++$sequence, 'email_status' => $notification->email_status === 'PENDING' ? 'FAILED' : $notification->email_status]);
                }
                DB::table('notification_counters')->insert(['recipient_id' => $recipient->recipient_id, 'sequence' => $sequence, 'created_at' => now('UTC'), 'updated_at' => now('UTC')]);
            }
        });
    }
}
