import sys

def dump_exports(dll_path):
    try:
        import pefile
        pe = pefile.PE(dll_path)
        for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
            if exp.name:
                print(exp.name.decode('utf-8'))
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    dump_exports(sys.argv[1])
