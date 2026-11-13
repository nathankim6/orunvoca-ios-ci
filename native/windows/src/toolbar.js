const $ = (id) => document.getElementById(id);
const MODES = ['desktop', 'tablet', 'phone'];
$('back').onclick = () => orunShell.back();
$('reload').onclick = () => orunShell.reload();
$('print').onclick = () => orunShell.print();
for (const m of MODES) $(m).onclick = () => orunShell.setMode(m);
orunShell.onMode((mode) => {
  for (const m of MODES) {
    $(m).classList.toggle('on', m === mode);
    $(m).setAttribute('aria-pressed', String(m === mode));
  }
});
