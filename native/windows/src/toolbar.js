const $ = (id) => document.getElementById(id);
$('back').onclick = () => orunShell.back();
$('reload').onclick = () => orunShell.reload();
$('print').onclick = () => orunShell.print();
$('desktop').onclick = () => orunShell.setMode('desktop');
$('phone').onclick = () => orunShell.setMode('phone');
orunShell.onMode((m) => {
  $('desktop').classList.toggle('on', m === 'desktop');
  $('phone').classList.toggle('on', m === 'phone');
});
