import urllib.request
import json
import re
import urllib.parse

def search_github():
    url = "https://api.github.com/search/code?q=FTR_PARAM_CB_CONTROL+in:file"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            for item in data.get('items', [])[:3]:
                print(f"Match: {item['html_url']}")
                # download raw file
                raw_url = item['html_url'].replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
                try:
                    with urllib.request.urlopen(raw_url) as raw_res:
                        content = raw_res.read().decode('utf-8')
                        print(f"--- Content snippet of {item['name']} ---")
                        lines = content.split('\n')
                        for line in lines:
                            if "FTR_PARAM" in line or "FTR_RETCODE" in line:
                                print(line.strip())
                except Exception as e:
                    print("Error downloading raw:", e)
    except Exception as e:
        print("Error searching:", e)

if __name__ == "__main__":
    search_github()
