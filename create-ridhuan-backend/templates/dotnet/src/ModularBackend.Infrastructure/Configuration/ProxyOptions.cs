namespace ModularBackend.Infrastructure.Configuration;

public sealed class ProxyOptions
{
    public string[] KnownProxies { get; set; } = [];
    public int ForwardLimit { get; set; } = 1;
}
