using System.ComponentModel.DataAnnotations;

namespace ModularBackend.Infrastructure.Configuration;

public sealed class DatabaseOptions { [Required] public string ConnectionString { get; set; } = ""; }
public sealed class JwtOptions
{
    [Required, MinLength(32)] public string Secret { get; set; } = "";
    [Required] public string Issuer { get; set; } = "modular-net";
    [Required] public string Audience { get; set; } = "modular-net-clients";
}
public sealed class CacheOptions { public bool Enabled { get; set; } public string Prefix { get; set; } = "modular-net:v1"; [Range(1, 3600)] public int TtlSeconds { get; set; } = 60; }
public sealed class RedisOptions { public string ConnectionString { get; set; } = ""; }
public sealed class RateOptions
{
    [Required] public string Prefix { get; set; } = "modular-net:v1";
    public string Store { get; set; } = "memory";
    [Range(1, 1000)] public int InstanceCount { get; set; } = 1;
    public RateWindow Auth { get; set; } = new() { Max = 20 };
    public RateWindow Public { get; set; } = new() { Max = 100 };
    public RateWindow Internal { get; set; } = new() { Max = 200 };
}
public sealed class RateWindow { public int Max { get; set; } = 100; public int WindowMs { get; set; } = 60000; }
public sealed class UploadOptions
{
    public bool Enabled { get; set; } = true;
    public string Storage { get; set; } = "local";
    public string LocalRoot { get; set; } = "uploads";
    [Range(1, 104857600)] public long MaxBytes { get; set; } = 10485760;
    public string[] AllowedMime { get; set; } = ["image/png", "image/jpeg", "application/pdf"];
    public string Endpoint { get; set; } = "";
    public string Region { get; set; } = "us-east-1";
    public string Bucket { get; set; } = "";
    public bool ForcePathStyle { get; set; } = true;
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    [Range(1, 8760)] public int OrphanGraceHours { get; set; } = 24;
}
public sealed class CorsOptions { public string[] Origins { get; set; } = []; }
public sealed class TelemetryOptions { public bool Enabled { get; set; } public string Endpoint { get; set; } = "http://localhost:4317"; public string ServiceName { get; set; } = "modular-net"; }
