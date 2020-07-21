import {createHash} from 'crypto';
import * as fs from 'fs';

/**
 * Computes hash of the file at the given path, using 'sha1' by default, or any algorithm
 * supported by crypto.createHash().
 */
export async function checksumFile(filePath: string, algorithm: string = 'sha1'): Promise<string> {
  const shaSum = createHash(algorithm);
  const stream = fs.createReadStream(filePath);
  try {
    stream.on('data', (data) => shaSum.update(data));
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    return shaSum.digest('hex');
  } finally {
    stream.removeAllListeners();      // Isn't strictly necessary.
  }
}
