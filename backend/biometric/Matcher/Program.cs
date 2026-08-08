using System;
using System.IO;
using System.Text.Json;
using System.Collections.Generic;
using SourceAFIS;

namespace Matcher
{
    class Program
    {
        public class FingerprintRecord
        {
            public int userId { get; set; }
            public string templateB64 { get; set; }
        }

        static int Main(string[] args)
        {
            if (args.Length == 0) return 1;

            string command = args[0].ToLower();
            try
            {
                if (command == "enroll")
                {
                    if (args.Length < 2) return 1;
                    var template = CreateTemplateFromBmp(args[1]);
                    Console.WriteLine(Convert.ToBase64String(template.ToByteArray()));
                    return 0;
                }
                else if (command == "verify-all")
                {
                    if (args.Length < 3) return 1;
                    string probeBmpPath = args[1];
                    string jsonPath = args[2];

                    var probeTemplate = CreateTemplateFromBmp(probeBmpPath);
                    var matcher = new FingerprintMatcher(probeTemplate);
                    
                    string jsonContent = File.ReadAllText(jsonPath);
                    var records = JsonSerializer.Deserialize<List<FingerprintRecord>>(jsonContent);

                    double bestScore = 0;
                    int matchedUserId = -1;

                    foreach (var record in records)
                    {
                        if (string.IsNullOrEmpty(record.templateB64)) continue;
                        
                        var candidateBytes = Convert.FromBase64String(record.templateB64);
                        var candidateTemplate = new FingerprintTemplate(candidateBytes);
                        
                        double score = matcher.Match(candidateTemplate);
                        if (score > bestScore)
                        {
                            bestScore = score;
                            matchedUserId = record.userId;
                        }
                    }

                    if (bestScore >= 40.0) // Typical threshold
                    {
                        Console.WriteLine($"MATCHED_USER_ID:{matchedUserId}");
                    }
                    else
                    {
                        Console.WriteLine("NO_MATCH");
                    }
                    return 0;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 2;
            }
            return 1;
        }

        static FingerprintTemplate CreateTemplateFromBmp(string path)
        {
            byte[] fileBytes = File.ReadAllBytes(path);
            int width = BitConverter.ToInt32(fileBytes, 18);
            int height = Math.Abs(BitConverter.ToInt32(fileBytes, 22));
            int dataOffset = BitConverter.ToInt32(fileBytes, 10);
            int stride = ((width + 3) / 4) * 4;
            byte[] rawPixels = new byte[width * height];
            bool isTopDown = BitConverter.ToInt32(fileBytes, 22) < 0;

            for (int y = 0; y < height; y++)
            {
                int srcY = isTopDown ? y : (height - 1 - y);
                int srcOffset = dataOffset + srcY * stride;
                int dstOffset = y * width;
                Buffer.BlockCopy(fileBytes, srcOffset, rawPixels, dstOffset, width);
            }

            var image = new FingerprintImage(width, height, rawPixels);
            return new FingerprintTemplate(image);
        }
    }
}
