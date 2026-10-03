<?php

declare(strict_types=1);

return ['driver' => 'bcrypt', 'bcrypt' => ['rounds' => 12, 'verify' => true, 'limit' => 72], 'rehash_on_login' => true];
