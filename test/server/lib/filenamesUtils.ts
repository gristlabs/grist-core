import { filenameContentDisposition, filenameStarredContentDisposition } from 'app/server/lib/filenamesUtils';
import {assert} from 'chai';

describe('filenamesUtils', function() {

  it('removes non ASCII characters in filename attachment', function() {
      const content = filenameContentDisposition('attachment', 'sdf% èà_.pdf');
      assert.equal(content, 'attachment; filename="sdf _.pdf"');
  });

  it('encodes sanitized filename with starred attachment', function() {
      const content = filenameStarredContentDisposition('attachment', 'sdf% èà_.pdf');
      assert.equal(content, "attachment; filename*=UTF-8''sdf%20_.pdf");
    });
});
