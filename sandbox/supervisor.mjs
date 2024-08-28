import {spawn} from 'child_process';

let grist;

function startGrist(newConfig={}) {
  // H/T https://stackoverflow.com/a/36995148/11352427
  grist = spawn('./sandbox/run.sh', {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: {...process.env, GRIST_RUNNING_UNDER_SUPERVISOR: true}
  });
  grist.on('message', function(data) {
    if (data.action === 'restart') {
      console.log('Restarting Grist with new configuration');

      // Note that we only set this event handler here, after we have
      // a new environment to reload with. Small chance of a race here
      // in case something else sends a SIGINT before we do it
      // ourselves further below.
      grist.on('exit', () => {
        grist = startGrist(data.newConfig);
      });

      grist.kill('SIGINT');
    }
  });
  return grist;
}

startGrist();
