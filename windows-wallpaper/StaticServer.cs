using System.Net;
using System.Net.Sockets;
using System.Text;

namespace DeskworldsWallpaper;

// 极简静态文件服务器：只处理 GET，避免 Node 常驻进程
internal sealed class StaticServer
{
    private readonly string _root;
    private TcpListener? _listener;
    public int Port { get; private set; }
    public string Url => "http://127.0.0.1:" + Port + "/";

    private static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json", [".svg"] = "image/svg+xml", [".png"] = "image/png",
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif",
        [".webp"] = "image/webp", [".ico"] = "image/x-icon", [".mp4"] = "video/mp4",
        [".webm"] = "video/webm", [".wasm"] = "application/wasm", [".ttf"] = "font/ttf",
        [".woff"] = "font/woff", [".woff2"] = "font/woff2",
    };

    public StaticServer(string root) => _root = root;

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = Task.Run(AcceptLoopAsync);
    }

    private async Task AcceptLoopAsync()
    {
        while (true)
        {
            var client = await _listener!.AcceptTcpClientAsync();
            _ = Task.Run(() => HandleAsync(client));
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using (client)
        {
            var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true);
            var requestLine = await reader.ReadLineAsync();
            if (string.IsNullOrWhiteSpace(requestLine)) return;
            while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { } // 消费剩余请求头

            var parts = requestLine.Split(' ');
            if (parts.Length < 2 || !parts[0].StartsWith("GET"))
            {
                await WriteAsync(stream, 405, "text/plain", "Method Not Allowed");
                return;
            }
            var rawPath = Uri.UnescapeDataString(parts[1].Split('?')[0]);
            if (rawPath.EndsWith('/')) rawPath += "index.html";
            var file = Path.GetFullPath(Path.Combine(_root, rawPath.TrimStart('/')));
            if (!file.StartsWith(_root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
            {
                await WriteAsync(stream, 404, "text/plain", "Not Found");
                return;
            }

            var mime = Mime.TryGetValue(Path.GetExtension(file), out var m) ? m : "application/octet-stream";
            var bytes = await File.ReadAllBytesAsync(file);
            var head = Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\nContent-Type: " + mime + "\r\nContent-Length: " + bytes.Length +
                "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(head);
            await stream.WriteAsync(bytes);
            await stream.FlushAsync();
        }
    }

    private static async Task WriteAsync(NetworkStream s, int code, string mime, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var head = Encoding.ASCII.GetBytes(
            "HTTP/1.1 " + code + "\r\nContent-Type: " + mime + "\r\nContent-Length: " + bytes.Length +
            "\r\nConnection: close\r\n\r\n");
        await s.WriteAsync(head);
        await s.WriteAsync(bytes);
        await s.FlushAsync();
    }
}