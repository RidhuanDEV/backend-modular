using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;
using ModularBackend.Application;
using ModularBackend.Infrastructure.Configuration;

namespace ModularBackend.Infrastructure.Mail;

public sealed class SmtpNotificationSender(IOptions<SmtpOptions> options) : INotificationMailSender
{
    public bool Enabled => options.Value.Enabled;
    public async Task SendAsync(string recipient, string subject, string body, CancellationToken ct)
    {
        if (!Enabled) throw new InvalidOperationException("SMTP is disabled");
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(options.Value.From));
        message.To.Add(MailboxAddress.Parse(recipient));
        message.Subject = subject;
        message.Body = new TextPart("plain") { Text = body };
        using var client = new SmtpClient();
        await client.ConnectAsync(options.Value.Host, options.Value.Port,
            options.Value.Secure ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, ct);
        if (options.Value.User.Length > 0) await client.AuthenticateAsync(options.Value.User, options.Value.Password, ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
    }
}
