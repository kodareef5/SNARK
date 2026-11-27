"""Read the browser's records from a debug ZIP. The pictures stay in the archive."""

import collections
import json
import re
import sys
import zipfile
import zlib


def read(path, limit):
    records = {}
    with zipfile.ZipFile(path) as archive:
        counts = collections.Counter(archive.namelist())
        for name in ("report.json", "perf.json", "events.json", "log.json", "net.json"):
            if counts[name] != 1:
                raise ValueError(f"expected one {name}, found {counts[name]}")
            member = archive.getinfo(name)
            limit -= member.file_size
            if limit < 0:
                raise ValueError("the capture's JSON records exceed the size limit")
            records[name] = archive.read(member).decode("utf-8")
        records["pictures"] = [name for name in counts if re.fullmatch(r"shot-[0-9]{2,3}\.jpg", name)]
        if any(counts[name] != 1 for name in records["pictures"]):
            raise ValueError("the capture has duplicate pictures")
    return records


if __name__ == "__main__":
    try:
        print(json.dumps(read(sys.argv[1], int(sys.argv[2])), ensure_ascii=False))
    except (OSError, ValueError, RuntimeError, EOFError, zipfile.BadZipFile, zlib.error) as exc:
        sys.exit(str(exc))
