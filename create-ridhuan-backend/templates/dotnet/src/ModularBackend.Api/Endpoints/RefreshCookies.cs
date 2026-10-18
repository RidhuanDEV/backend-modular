using System.Text.RegularExpressions;
using ModularBackend.Application;

namespace ModularBackend.Api.Endpoints;

// Opt-in httpOnly cookie transport for the refresh token (RefreshCookie__Transport=cookie).
// The token never reaches JavaScript, and because browsers attach cookies automatically,
// cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom header
// forces a CORS preflight, so only allowlisted origins can send it.
public sealed partial class RefreshCookies
{
    private const string CookiePath = "/api/auth";

    // Matches the refresh token lifetime; the server still enforces the real expiry.
    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(30);

    private readonly string name;
    private readonly SameSiteMode sameSite;
    private readonly string? domain;
    private readonly bool secure;

    public bool Enabled { get; }

    public RefreshCookies(IConfiguration configuration)
    {
        var transport = configuration["RefreshCookie:Transport"] ?? "body";
        if (transport is not ("body" or "cookie"))
            throw new InvalidOperationException("RefreshCookie:Transport must be body or cookie");
        Enabled = transport == "cookie";
        name = configuration["RefreshCookie:Name"] ?? "refresh_token";
        if (!CookieName().IsMatch(name))
            throw new InvalidOperationException(
                "RefreshCookie:Name must match [A-Za-z0-9_-]{1,64}"
            );
        // lax/strict for same-site frontends (including sibling subdomains); none for cross-site.
        sameSite = (configuration["RefreshCookie:SameSite"] ?? "lax") switch
        {
            "lax" => SameSiteMode.Lax,
            "strict" => SameSiteMode.Strict,
            "none" => SameSiteMode.None,
            _ => throw new InvalidOperationException(
                "RefreshCookie:SameSite must be lax, strict or none"
            ),
        };
        domain = configuration["RefreshCookie:Domain"] is { Length: > 0 } value ? value : null;
        if (domain is not null && !CookieDomain().IsMatch(domain))
            throw new InvalidOperationException("RefreshCookie:Domain is invalid");
        secure = configuration.GetValue<bool?>("RefreshCookie:Secure") ?? true;
        if (sameSite == SameSiteMode.None && !secure)
            throw new InvalidOperationException("SameSite=None cookies must be Secure");
    }

    private CookieOptions Options(TimeSpan? maxAge) =>
        new()
        {
            HttpOnly = true,
            Secure = secure,
            SameSite = sameSite,
            Path = CookiePath,
            Domain = domain,
            MaxAge = maxAge,
        };

    // Sets the cookie and strips the token from the body in cookie mode.
    public AuthTokensResult Issue(HttpResponse response, AuthTokensResult tokens)
    {
        if (!Enabled)
            return tokens;
        response.Cookies.Append(name, tokens.RefreshToken!, Options(MaxAge));
        return tokens with { RefreshToken = null };
    }

    public void Clear(HttpResponse response)
    {
        if (Enabled)
            response.Cookies.Delete(name, Options(null));
    }

    // A body token always wins; otherwise cookie mode reads the httpOnly cookie.
    public string Token(HttpRequest request, string? bodyToken)
    {
        if (!string.IsNullOrEmpty(bodyToken))
            return bodyToken;
        if (Enabled && request.Cookies.TryGetValue(name, out var token) && token.Length > 0)
        {
            if (string.IsNullOrEmpty(request.Headers["X-Requested-With"]))
                throw new ApiException(
                    403,
                    "Cookie-based refresh requires the X-Requested-With header"
                );
            return token;
        }
        throw new ApiException(400, "refreshToken is required");
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex CookieName();

    [GeneratedRegex(@"^\.?[A-Za-z0-9.-]+$")]
    private static partial Regex CookieDomain();
}
