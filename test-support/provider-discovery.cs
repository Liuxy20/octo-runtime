using System;

// 仅用于 discovery 测试：真实进程只接受单个版本参数，不依赖 shell 或 Provider。
class ProviderDiscoveryFixture
{
    static int Main(string[] args)
    {
        if (args.Length != 1 || args[0] != "--version") return 23;
        Console.WriteLine("provider v1.2.3");
        return 0;
    }
}
