
import React, { useMemo, useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area 
} from 'recharts';
import { 
  TrendingUp, Users, FileText, DollarSign, 
  Package, ArrowUpRight, ArrowDownRight, Activity, Download, FileSpreadsheet 
} from 'lucide-react';
import { InvoiceData, SavedQuote, CustomerAccount, Payment, InventoryPart, QuoteItem } from '../types.ts';
import { exportQuotes } from '../services/exportService.ts';

interface DashboardProps {
  invoices: InvoiceData[];
  quotes: SavedQuote[];
  accounts: CustomerAccount[];
  payments: Payment[];
  inventory: InventoryPart[];
  onDataLoaded?: (items: QuoteItem[]) => void;
  onNavigateToQuoting?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ invoices, quotes, accounts, payments, inventory, onDataLoaded, onNavigateToQuoting }) => {
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  const stats = useMemo(() => {
    const totalRevenue = invoices.reduce((sum, inv) => sum + inv.total, 0);
    const totalPaid = payments.reduce((sum, pay) => sum + pay.amount, 0);
    const pendingAmount = totalRevenue - totalPaid;
    const conversionRate = quotes.length > 0 ? (invoices.length / quotes.length) * 100 : 0;
    
    // Monthly Revenue & Weight
    const monthlyData: Record<string, { total: number; weight: number }> = {};
    invoices.forEach(inv => {
      const month = inv.date.substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) monthlyData[month] = { total: 0, weight: 0 };
      monthlyData[month].total += inv.total;
    });

    quotes.forEach(q => {
      const month = q.timestamp.substring(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { total: 0, weight: 0 };
      monthlyData[month].weight += q.payload.items.reduce((sum, item) => sum + (item.qty * item.weight), 0);
    });
    
    const chartData = Object.entries(monthlyData)
      .map(([name, data]) => ({ name, total: data.total, weight: data.weight }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(-6);

    // Customer Distribution
    const customerRevenue: Record<string, number> = {};
    invoices.forEach(inv => {
      const account = accounts.find(a => a.id === inv.clientId);
      const name = account?.company || 'Unknown';
      customerRevenue[name] = (customerRevenue[name] || 0) + inv.total;
    });

    const pieData = Object.entries(customerRevenue)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Top Parts by Volume (from quotes)
    const partVolume: Record<string, number> = {};
    quotes.forEach(q => {
      q.payload.items.forEach(item => {
        partVolume[item.partNo] = (partVolume[item.partNo] || 0) + item.qty;
      });
    });

    const topParts = Object.entries(partVolume)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    const totalWeight = quotes.reduce((sum, q) => {
      return sum + q.payload.items.reduce((iSum, item) => iSum + (item.qty * item.weight), 0);
    }, 0);

    return {
      totalRevenue,
      totalPaid,
      pendingAmount,
      conversionRate,
      chartData,
      pieData,
      topParts,
      totalWeight
    };
  }, [invoices, quotes, accounts, payments]);

  const COLORS = ['#ffcd00', '#000000', '#4b5563', '#9ca3af', '#e5e7eb'];

  return (
    <div className="p-8 bg-slate-50 min-h-screen font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Logistics Intelligence</h1>
            <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mt-1">Real-time Engineering & Revenue Metrics</p>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <button 
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 hover:border-cat-yellow transition-all"
              >
                <Download className="w-4 h-4 text-slate-600" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Export Quotes</span>
              </button>
              
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 z-50 animate-in fade-in zoom-in-95">
                  <button 
                    onClick={() => { exportQuotes(quotes, 'excel'); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    Excel (.xlsx)
                  </button>
                  <button 
                    onClick={() => { exportQuotes(quotes, 'csv'); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-3 text-[10px] font-black uppercase rounded-xl hover:bg-cat-yellow/10 hover:text-cat-black flex items-center gap-3 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-blue-600" />
                    CSV (.csv)
                  </button>
                </div>
              )}
            </div>
            <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">System Live</span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Total Revenue" 
            value={`$${stats.totalRevenue.toLocaleString()}`} 
            icon={<DollarSign className="w-5 h-5" />}
            trend="+12.5%"
            trendUp={true}
          />
          <StatCard 
            title="Active Quotes" 
            value={quotes.length.toString()} 
            icon={<FileText className="w-5 h-5" />}
            trend="+3 new"
            trendUp={true}
          />
          <StatCard 
            title="Conversion" 
            value={`${stats.conversionRate.toFixed(1)}%`} 
            icon={<TrendingUp className="w-5 h-5" />}
            trend="-2.1%"
            trendUp={false}
          />
          <StatCard 
            title="Weight Moved" 
            value={`${(stats.totalWeight / 2000).toFixed(1)} Tons`} 
            icon={<Activity className="w-5 h-5" />}
            trend="+0.4t"
            trendUp={true}
          />
        </div>

        {/* Quick Intake Section */}
        <div className="bg-cat-black p-8 rounded-[3rem] shadow-2xl shadow-cat-black/20 border border-white/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-cat-yellow/10 rounded-full blur-3xl -mr-32 -mt-32 group-hover:bg-cat-yellow/20 transition-all duration-700"></div>
          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="text-center md:text-left">
              <h2 className="text-2xl font-black uppercase tracking-tighter text-white mb-2">Quick Intake Center</h2>
              <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest">Upload an email quote (PDF/Excel) to instantly generate a manifest</p>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => onNavigateToQuoting?.()}
                className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all border border-white/10"
              >
                Open Portal
              </button>
              <button 
                onClick={() => onNavigateToQuoting?.()}
                className="px-8 py-4 bg-cat-yellow text-cat-black text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-xl shadow-cat-yellow/20 hover:scale-105 active:scale-95"
              >
                Upload Quote
              </button>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Main Revenue Chart */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">Revenue Velocity</h3>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.chartData}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ffcd00" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#ffcd00" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                    tickFormatter={(value) => `$${value/1000}k`}
                  />
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px'}}
                    itemStyle={{fontSize: '12px', fontWeight: 800, color: '#0f172a'}}
                  />
                  <Area type="monotone" dataKey="total" stroke="#ffcd00" strokeWidth={4} fillOpacity={1} fill="url(#colorTotal)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Logistics Weight Chart */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">Logistics Throughput</h3>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                    tickFormatter={(value) => `${value/1000}t`}
                  />
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px'}}
                    itemStyle={{fontSize: '12px', fontWeight: 800, color: '#0f172a'}}
                  />
                  <Bar dataKey="weight" fill="#000000" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Market Share & Bottom Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Customer Pie Chart */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-8">Market Share</h3>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {stats.pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {stats.pieData.map((entry, index) => (
                <div key={entry.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[index % COLORS.length]}}></div>
                    <span className="text-[10px] font-bold text-slate-600 truncate max-w-[100px]">{entry.name}</span>
                  </div>
                  <span className="text-[10px] font-black text-slate-900">${(entry.value / 1000).toFixed(1)}k</span>
                </div>
              ))}
            </div>
          </div>
          {/* Top Parts Chart */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-8">High-Volume Parts</h3>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topParts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#64748b', fontSize: 10, fontWeight: 700}}
                    width={80}
                  />
                  <Tooltip 
                    cursor={{fill: 'transparent'}}
                    contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                  />
                  <Bar dataKey="qty" fill="#ffcd00" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-6">Logistics Stream</h3>
            <div className="space-y-4">
              {invoices.slice(-4).reverse().map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${inv.status === 'paid' ? 'bg-emerald-100 text-emerald-600' : 'bg-cat-yellow/20 text-cat-black'}`}>
                      <Package className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-900 uppercase tracking-tight">INV {inv.id.split('-').pop()}</p>
                      <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">{inv.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-slate-900">${(inv.total ?? 0).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Efficiency Metrics */}
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-slate-100">
            <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 mb-6">Operational Efficiency</h3>
            <div className="space-y-6">
              <EfficiencyBar label="Quote Turnaround" percentage={85} color="#ffcd00" />
              <EfficiencyBar label="Inventory Accuracy" percentage={98} color="#000000" />
              <EfficiencyBar label="Payment Velocity" percentage={72} color="#4b5563" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ title: string; value: string; icon: React.ReactNode; trend: string; trendUp: boolean }> = ({ title, value, icon, trend, trendUp }) => (
  <div className="bg-white p-6 rounded-[2rem] shadow-lg shadow-slate-200/40 border border-slate-100 group hover:border-cat-yellow transition-colors">
    <div className="flex justify-between items-start mb-4">
      <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-cat-yellow transition-colors">
        {icon}
      </div>
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight ${trendUp ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
        {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {trend}
      </div>
    </div>
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">{title}</p>
    <h4 className="text-2xl font-black text-slate-900 tracking-tighter">{value}</h4>
  </div>
);

const EfficiencyBar: React.FC<{ label: string; percentage: number; color: string }> = ({ label, percentage, color }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-end">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <span className="text-xs font-black text-slate-900">{percentage}%</span>
    </div>
    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
      <div 
        className="h-full transition-all duration-1000 ease-out" 
        style={{ width: `${percentage}%`, backgroundColor: color }}
      ></div>
    </div>
  </div>
);
