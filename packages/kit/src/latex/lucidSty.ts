/**
 * The Lucid house style: Latin Modern, underlined title,
 * footer "Page N" left and the footer text right with a thin rule, numbered sections, framed listings. Written next to
 * main.tex at export time. fontspec gives full Unicode text (Tectonic finds the Latin Modern OpenType files by file name, not family name); `\fancypagestyle{plain}` keeps the footer on page 1.
 */
export const LUCID_STY = String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{lucid}[2026/10/10 Lucid house style]
\RequirePackage{fontspec}
\setmainfont{lmroman10}[Extension=.otf,UprightFont=*-regular,BoldFont=*-bold,ItalicFont=*-italic,BoldItalicFont=*-bolditalic]
\setsansfont{lmsans10}[Extension=.otf,UprightFont=*-regular,BoldFont=*-bold,ItalicFont=*-oblique,BoldItalicFont=*-boldoblique]
\setmonofont{lmmono10}[Extension=.otf,UprightFont=*-regular,BoldFont=*-regular,ItalicFont=*-regular,BoldItalicFont=*-regular]
\RequirePackage{listings,xcolor,float,fancyhdr,graphicx}
\RequirePackage[normalem]{ulem}
\RequirePackage{booktabs,tabularx,array}
\RequirePackage[most]{tcolorbox}
\RequirePackage{amsmath,amssymb}
\RequirePackage{enumitem}
\RequirePackage{pifont}
\RequirePackage{siunitx}
\RequirePackage[hidelinks]{hyperref}
\newcommand{\lucidfooterright}{}
\pagestyle{fancy}\fancyhf{}
\rfoot{\small\lucidfooterright}\lfoot{\small Page \thepage}
\renewcommand{\headrulewidth}{0pt}\renewcommand{\footrulewidth}{0.1pt}
\fancypagestyle{plain}{\fancyhf{}\rfoot{\small\lucidfooterright}\lfoot{\small Page \thepage}%
  \renewcommand{\headrulewidth}{0pt}\renewcommand{\footrulewidth}{0.1pt}}
\lstset{basicstyle=\footnotesize\ttfamily,keywordstyle=\color{blue},commentstyle=\color{green!40!black},
  stringstyle=\color{red},showstringspaces=false,frame=single,breaklines=true,numbers=left,
  numberstyle=\tiny,numbersep=5pt,tabsize=2,captionpos=b,columns=fullflexible,keepspaces=true}
\newtcolorbox{lucidcallout}[2]{colback=#1!6,colframe=#1!60!black,boxrule=0.4pt,arc=1pt,left=4pt,right=4pt,
  top=2pt,bottom=2pt,title={\small\bfseries #2},coltitle=black,colbacktitle=#1!15,breakable}
\newlength{\lucidfigw}
% Table text is set ragged right: in narrow columns, justified words are pulled far apart.
\newcolumntype{Y}{>{\raggedright\arraybackslash}X}
\newcommand{\lucidmeta}[2]{\noindent\textbf{#1:} #2\par}
\newcommand{\lucidstruck}[1]{\textcolor{black!55}{\sout{#1}}}
\newcommand{\lucidchosen}[1]{\textbf{#1}~\ding{51}}
\setlist{itemsep=2pt,topsep=4pt}
% A tall figure may take most of a page: at the top with text under it, or, when it fills 80% of a page or more, a page of its own.
\renewcommand{\topfraction}{0.85}\renewcommand{\textfraction}{0.1}\renewcommand{\floatpagefraction}{0.8}
\endinput
`;
