// Based on the source code of the Body.textConverted method in node-fetch
export function httpEncoding(header: string | null, content: Buffer): string | undefined {
  let res: RegExpExecArray | null = null;

  // header
  if (header) {
    res = /charset=([^;]*)/i.exec(header);
  }

  // no charset in content type, peek at response body for at most 1024 bytes
  const str = content.slice(0, 1024).toString();

  // html5
  if (!res && str) {
    res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
  }

  // html4
  if (!res && str) {
    res = /<meta\s+?http-equiv=(['"])content-type\1\s+?content=(['"])(.+?)\2/i.exec(str);

    if (res) {
      res = /charset=(.*)/i.exec(res.pop()!);
    }
  }

  // xml
  if (!res && str) {
    res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str);
  }

  // found charset
  if (res) {
    let charset = res.pop();

    // prevent decode issues when sites use incorrect encoding
    // ref: https://hsivonen.fi/encoding-menu/
    if (charset === 'gb2312' || charset === 'gbk') {
      charset = 'gb18030';
    }
    return charset;
  }
}
