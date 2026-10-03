<?php

declare(strict_types=1);

return [
    'default' => 'sync',
    'connections' => ['sync' => ['driver' => 'sync']],
    'failed' => ['driver' => 'null'],
];
