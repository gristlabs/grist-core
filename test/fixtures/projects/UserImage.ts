/**
 * This test page shows the circular user-icons for users with and without images.
 */
import {createUserImage, Size} from 'app/client/ui/UserImage';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {dom, styled} from 'grainjs';
import range = require('lodash/range');

function setupTest() {
  return dom('div',
    dom('h3', 'Legend'),
    cssTestBox(
      createUserImage({name: ' ', email: 'foo@example.com'}, 'medium'),
      createUserImage({name: 'George  Washington', email: 'gf@example.com'}, 'medium'),
      dom('div', 'One- or two-letter initials'),
    ),
    cssTestBox(
      createUserImage({name: '', email: ''}, 'medium'),
      createUserImage({name: undefined as any, email: undefined as any}, 'medium'),
      dom('div', 'Missing name or email (not supposed to happen)'),
    ),
    cssTestBox(
      createUserImage(null, 'medium'),
      createUserImage({name: 'Anonymous', email: 'anon@example.com',
        picture: 'https://avatars2.githubusercontent.com/u/1091143?s=40&v=4',
        anonymous: true, // this should take priority.
      }, 'medium'),
      dom('div', 'Missing or anonymous user (image not normally used)'),
    ),
    cssTestBox(
      createUserImage({name: 'Someone', email: '',
        picture: 'https://avatars2.githubusercontent.com/u/1091143?s=40&v=4'}, 'medium'),
      createUserImage({name: 'Someone', email: '',
        picture: 'https://www.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50'}, 'medium'),
      dom('div', 'An actual image (from gravatar.com)'),
    ),
    dom('h3', 'Medium (app header)'),
    createAssorted('medium'),
    cssTestBox(
      dom.forEach(range(20).map(i => `A${i}`), (name) =>
        createUserImage({name, email: ''}, 'medium')
      ),
    ),
    cssTestBox(
      dom.forEach(range(20).map(i => `J M${i}`), (name) =>
        createUserImage({name, email: ''}, 'medium')
      ),
    ),
    dom('h3', 'Small (current users on the document)'),
    createAssorted('small'),
    dom('h3', 'Large (manage users dialog)'),
    createAssorted('large'),
  );
}

function createAssorted(size: Size) {
  return cssTestBox(
    createUserImage({name: 'George  Washington', email: 'gf@example.com'}, size),
    createUserImage({name: 'D S', email: ''}, size),
    createUserImage({name: ' ', email: 'foo@example.com'}, size),
    createUserImage({name: 'Bob', email: ''}, size),
    createUserImage({name: '', email: ''}, size),
    createUserImage({name: undefined as any, email: undefined as any}, size),
    createUserImage(null, size),
    createUserImage({name: 'Anonymous', email: 'anon@example.com',
      picture: 'https://avatars2.githubusercontent.com/u/1091143?s=40&v=4',
      anonymous: true, // this should take priority.
    }, size),
    // Dmitry's gravatar
    createUserImage({name: '', email: '',
      picture: 'https://avatars2.githubusercontent.com/u/1091143?s=40&v=4'}, size),
    // Image from https://en.gravatar.com/site/implement/images/
    createUserImage({name: 'Someone', email: '',
      picture: 'https://www.gravatar.com/avatar/205e460b479e2e5b48aec07710c08d50'}, size),
    createUserImage({name: 'Someone', email: '',
      picture: 'https://www.gravatar.com/avatar/00000000000000000000000000000000'}, size),
  );
}

const cssTestBox = styled('div', `
  display: flex;
  align-items: center;
  & > div {
    margin: 4px;
  }
`);

dom.update(document.body, dom.cls(cssRootVars), setupTest());
