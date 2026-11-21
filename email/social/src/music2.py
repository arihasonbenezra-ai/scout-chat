import math, struct, sys, random
random.seed(7)
SR=44100; DUR=float(sys.argv[1]); OUT=sys.argv[2]
N=int(SR*DUR); L=[0.0]*N; R=[0.0]*N
BPM=84; BEAT=60/BPM; BAR=4*BEAT; SW=0.09*BEAT   # swing on the offbeat 8ths
def hz(n): return 440.0*2**((n-69)/12)
def add(i,l,r):
    if 0<=i<N: L[i]+=l; R[i]+=r
# ---- Rhodes-ish electric piano
def rhodes(note, t0, dur, amp, pan=0.5):
    f=hz(note); n0=int(t0*SR); n1=min(N,int((t0+dur)*SR)+int(0.5*SR)); rel=int(0.45*SR)
    for i in range(n0,n1):
        k=i-n0; t=k/SR
        env = min(1.0,k/(0.006*SR))*(0.35+0.65*math.exp(-3.2*t))
        if k>(n1-n0-rel): env*=max(0.0,(n1-i)/rel)
        trem=1+0.12*math.sin(2*math.pi*4.6*t)
        s=math.sin(2*math.pi*f*t)+0.45*math.sin(2*math.pi*2*f*t)*math.exp(-4*t)+0.18*math.sin(2*math.pi*3*f*t)*math.exp(-6*t)+0.25*math.sin(2*math.pi*4*f*t+0.3)*math.exp(-9*t)
        sl=s*0.5+0.5*math.sin(2*math.pi*f*1.0025*t)*math.exp(-1.5*t)   # detuned chorus layer
        v=env*trem*amp
        add(i, v*(sl)*(1-pan)*1.4, v*s*pan*1.4)
# ---- bass
def bass(note, t0, dur, amp):
    f=hz(note); n0=int(t0*SR); n1=min(N,int((t0+dur)*SR))
    for i in range(n0,n1):
        k=i-n0; t=k/SR
        env=min(1.0,k/(0.01*SR))*math.exp(-1.2*t)*min(1.0,(n1-i)/(0.03*SR))
        s=math.sin(2*math.pi*f*t)+0.3*math.sin(2*math.pi*2*f*t)*math.exp(-5*t)
        v=math.tanh(1.6*s)*env*amp
        add(i,v,v)
# ---- drums
def kick(t0, amp):
    n0=int(t0*SR)
    for k in range(int(0.3*SR)):
        t=k/SR; f=45+120*math.exp(-28*t)
        v=math.sin(2*math.pi*f*t)*math.exp(-9*t)*amp
        add(n0+k, v, v)
def snare(t0, amp):
    n0=int(t0*SR)
    for k in range(int(0.22*SR)):
        t=k/SR
        v=((random.random()*2-1)*math.exp(-16*t)*0.8+0.4*math.sin(2*math.pi*185*t)*math.exp(-22*t))*amp
        add(n0+k, v*0.9, v*1.0)
def hat(t0, amp, open_=False):
    n0=int(t0*SR); d=0.18 if open_ else 0.06; prev=0.0
    for k in range(int(d*SR)):
        t=k/SR; x=(random.random()*2-1); hp=x-prev; prev=x   # crude high-pass
        v=hp*math.exp(-(14 if open_ else 55)*t)*amp
        add(n0+k, v*0.6, v*0.8)
# ---- progression (10+ bars): Dm9 G13 Cmaj9 Am9 | Fmaj9 Em7 Dm9 G13 | Cmaj9 Cmaj9 ...
PROG=[[62,65,69,72,76],[55,59,65,69,76],[60,64,67,71,74],[57,60,64,67,71],
      [53,57,60,64,67],[52,55,59,62,67],[62,65,69,72,76],[55,59,65,69,76],
      [60,64,67,71,74],[60,64,67,71,74],[57,60,64,67,71],[60,64,67,71,74]]
ROOT=[50,43,48,45,41,40,50,43,48,48,45,48]
bars=int(DUR/BAR)+1
for b in range(bars):
    t=b*BAR; ch=PROG[b%len(PROG)]; root=ROOT[b%len(ROOT)]
    # comping: stab on 1 (long), "and of 2" (short), beat 4 (medium)
    for j,n in enumerate(ch):
        pan=0.35+0.3*j/4
        rhodes(n, t+0.004*j, 1.6*BEAT, 0.11, pan)
        rhodes(n, t+1.5*BEAT+SW+0.004*j, 0.7*BEAT, 0.07, pan)
        rhodes(n, t+3*BEAT+0.004*j, 0.9*BEAT, 0.075, pan)
    # bass: root on 1, fifth on 2.5, root/octave on 3.5
    bass(root, t, 1.4*BEAT, 0.22); bass(root+7, t+1.5*BEAT+SW, 0.6*BEAT, 0.16); bass(root, t+2.5*BEAT+SW, 0.9*BEAT, 0.2)
    if b%4==3: bass(root+12, t+3.5*BEAT+SW, 0.45*BEAT, 0.14)
    # drums
    kick(t, 0.55); kick(t+2.5*BEAT+SW, 0.42)
    if b%2==1: kick(t+3.75*BEAT, 0.3)
    snare(t+BEAT, 0.2); snare(t+3*BEAT, 0.22)
    for e in range(8):
        te=t+e*0.5*BEAT+(SW if e%2 else 0)
        hat(te, 0.075 if e%2==0 else 0.045, open_=(e==7 and b%2==1))
# vinyl crackle + hiss
for i in range(N):
    if random.random()<0.00005:
        a=random.random()*0.07
        for k in range(int(0.004*SR)): add(i+k, a*math.exp(-900*k/SR)*(random.random()*2-1), a*math.exp(-900*k/SR)*(random.random()*2-1))
# gentle low-pass (lo-fi) and soft saturation
def lp(x, c=0.22):
    y=0.0
    for i in range(len(x)):
        y+=c*(x[i]-y); x[i]=y
    return x
L=lp(L); R=lp(R)
L=[math.tanh(1.3*v) for v in L]; R=[math.tanh(1.3*v) for v in R]
pk=max(max(map(abs,L)),max(map(abs,R))) or 1; g=0.7/pk
data=b''.join(struct.pack('<hh', int(L[i]*g*32767), int(R[i]*g*32767)) for i in range(N))
with open(OUT,'wb') as f:
    f.write(b'RIFF'+struct.pack('<I',36+len(data))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,2,SR,SR*4,4,16)+b'data'+struct.pack('<I',len(data))+data)
print('music2 ok', DUR, 'bars', bars)
