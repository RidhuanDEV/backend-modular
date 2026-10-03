<?php

declare(strict_types=1);

namespace App\Infrastructure\RateLimit;

use App\Support\Config\Settings;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;

final class FileQuotaCleaner
{
    public function clean(bool $apply, int $limit): int
    {
        $root = Settings::string('cache.stores.quota.path');
        if (! is_dir($root)) {
            return 0;
        }
        $count = 0;
        $scanned = 0;
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, RecursiveDirectoryIterator::SKIP_DOTS)) as $file) {
            if (++$scanned > 10000 || $count >= $limit) {
                break;
            }
            if (! $file instanceof SplFileInfo || ! $file->isFile() || $file->isLink() || ! preg_match('/^[a-f0-9]{40}$/D', $file->getFilename())) {
                continue;
            }
            $lock = storage_path('framework/cache/quota-locks/'.substr($file->getFilename(), 0, 2).'.lock');
            $handle = fopen($lock, 'c');
            if ($handle === false) {
                continue;
            }
            try {
                if (! flock($handle, LOCK_EX | LOCK_NB)) {
                    continue;
                }
                $stream = fopen($file->getPathname(), 'rb');
                if ($stream === false) {
                    continue;
                }
                try {
                    $header = fread($stream, 10);
                } finally {
                    fclose($stream);
                }
                if (! is_string($header) || ! ctype_digit($header) || (int) $header >= time()) {
                    continue;
                }
                $count++;
                if ($apply) {
                    unlink($file->getPathname());
                }
            } finally {
                flock($handle, LOCK_UN);
                fclose($handle);
            }
        }

        return $count;
    }
}
