const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('xenoterm-admin-token') || '';
const format = value => Number(value || 0).toLocaleString('zh-CN');
function cellRow(values) { const row = document.createElement('tr'); for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); } return row; }
function showChart(data) {
  const end = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00Z');
  const rows = [];
  for (let n = data.days - 1; n >= 0; n--) { const day = new Date(end.getTime() - n * 86400000).toISOString().slice(0,10); rows.push({ day, downloads:0, manual_downloads:0, update_downloads:0, ...data.daily.find(r => r.day === day) }); }
  const chart = $('chart'); chart.replaceChildren();
  const max = Math.max(1, ...rows.map(row => row.downloads));
  const ns = 'http://www.w3.org/2000/svg';
  const line = document.createElementNS(ns,'path'); line.setAttribute('d','M0 190 H1000 M0 95 H1000 M0 0 H1000'); line.setAttribute('stroke','#e5e4de'); chart.append(line);
  rows.forEach((row, i) => { const bar = document.createElementNS(ns,'rect'); const width=1000/rows.length; bar.setAttribute('x',String(i*width+width*.17));bar.setAttribute('y',String(190-row.downloads/max*175));bar.setAttribute('width',String(width*.66));bar.setAttribute('height',String(row.downloads/max*175));bar.setAttribute('rx','2');bar.setAttribute('fill','#cc7d5e');const title=document.createElementNS(ns,'title');title.textContent=`${row.day}：${row.downloads} 次`;bar.append(title);chart.append(bar); });
  $('start-day').textContent=rows[0].day;$('end-day').textContent=rows.at(-1).day;
  $('chart-total').textContent=`期间合计 ${format(rows.reduce((sum,r)=>sum+r.downloads,0))} 次`;
  $('daily-table').replaceChildren(...rows.toReversed().map(row=>cellRow([row.day,format(row.manual_downloads),format(row.update_downloads),format(row.downloads)])));
}
async function refresh() {
  $('admin-error').hidden=true;$('refresh').disabled=true;
  const submit=$('login').querySelector('button');submit.disabled=true;
  try {
    const response=await fetch(`/api/stats/downloads?days=${$('days').value}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
    if(response.status===401){sessionStorage.removeItem('xenoterm-admin-token');$('login').hidden=false;$('dashboard').hidden=true;$('admin-actions').hidden=true;throw Error('管理密钥不正确，请重新输入。');}
    if(!response.ok)throw Error(response.status===429?'尝试次数过多，请一分钟后重试。':'暂时无法获取统计，请稍后重试。');
    const data=await response.json();sessionStorage.setItem('xenoterm-admin-token',token);$('token').value='';$('login').hidden=true;$('dashboard').hidden=false;$('admin-actions').hidden=false;
    for(const [id,key] of Object.entries({total:'downloads',today:'today_downloads',manual:'manual_downloads',updates:'update_downloads'}))$(id).textContent=format(data.summary[key]);
    showChart(data);
    $('versions').replaceChildren(...(data.byVersion.length?data.byVersion.map(row=>cellRow([row.version==='unknown'?'未标记版本':`v${row.version}`,format(row.manual_downloads),format(row.update_downloads),format(row.update_checks),format(row.downloads)])):[cellRow(['暂无下载记录','—','—','—','—'])]));
    $('updated-at').textContent=`最近刷新：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`;
  }catch(error){$('admin-error').textContent=error.message;$('admin-error').hidden=false;}finally{$('refresh').disabled=false;submit.disabled=false;}
}
$('login').addEventListener('submit',e=>{e.preventDefault();token=$('token').value.trim();refresh();});$('refresh').addEventListener('click',refresh);$('days').addEventListener('change',refresh);$('logout').addEventListener('click',()=>{token='';sessionStorage.removeItem('xenoterm-admin-token');$('dashboard').hidden=true;$('admin-actions').hidden=true;$('login').hidden=false;$('admin-error').hidden=true;$('token').focus();});if(token)refresh();
