<?php

declare(strict_types=1);

// Disposable acceptance certificate only; key stays in fixture process memory.
try {
    $configuration = tempnam(sys_get_temp_dir(), 'laravel-tls-');
    if ($configuration === false) {
        throw new RuntimeException('Certificate configuration unavailable');
    }
    try {
        file_put_contents(
            $configuration,
            "[req]\ndistinguished_name=dn\nx509_extensions=fixture\n[dn]\n[fixture]\nbasicConstraints=critical,CA:TRUE\nsubjectAltName=DNS:host.docker.internal\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n",
        );
        $options = [
            'config' => $configuration,
            'digest_alg' => 'sha256',
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
            'x509_extensions' => 'fixture',
        ];
        $key = openssl_pkey_new($options);
        if ($key === false) {
            throw new RuntimeException('Certificate key unavailable');
        }
        $request = openssl_csr_new(
            ['commonName' => 'host.docker.internal'],
            $key,
            $options,
        );
        $certificate =
            $request === false
                ? false
                : openssl_csr_sign($request, null, $key, 2, $options);
        if (
            $certificate === false ||
            !openssl_x509_export($certificate, $public) ||
            !openssl_pkey_export($key, $private, null, $options)
        ) {
            throw new RuntimeException('Certificate creation failed');
        }
        echo json_encode(
            ['cert' => $public, 'key' => $private],
            JSON_THROW_ON_ERROR,
        );
    } finally {
        unlink($configuration);
    }
} catch (Throwable $failure) {
    fwrite(STDERR, 'Certificate fixture failed: ' . $failure::class . PHP_EOL);
    exit(1);
}
