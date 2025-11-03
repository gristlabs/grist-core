function removesNonASCII(filename: string){
    return filename.replace(/[^\x20-\x7E]/g, '').replace('%', '');
}

export function filenameContentDisposition(disposition: string, filename: string){
    return `${disposition}; filename="${removesNonASCII(filename)}"; filename*=utf-8''${encodeURIComponent(filename)}`;
}