import { filenameContentDisposition } from 'app/server/lib/filenamesUtils';
import {assert} from 'chai';

describe('filenamesUtils', function() {
// https://datatracker.ietf.org/doc/html/rfc5987#section-4.2
  it('removes non ASCII characters in filename and encodes sanitized with starred attachment', function() {
      const content = filenameContentDisposition('attachment', 'sdf% èà_.pdf');
      assert.equal(content, `attachment; filename="sdf _.pdf"; filename*=UTF-8''sdf%25%20%C3%A8%C3%A0_.pdf`);
  });
});
