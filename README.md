# TED Writing Toy

一个给自己玩的英语写作练习小工具。看懂一小段，再用自己的英文写一句概括，最后打开原文对照。边用边改，不保证学习效果。

## 从哪来的

灵感来自 [这条英语学习方法视频](https://www.youtube.com/watch?v=Hd9s5jJFhU4)，其中的流程是：[无字幕理解](https://www.youtube.com/watch?v=Hd9s5jJFhU4&t=695s) → [先自己概括](https://www.youtube.com/watch?v=Hd9s5jJFhU4&t=742s) → [打开原文核对](https://www.youtube.com/watch?v=Hd9s5jJFhU4&t=800s)。

这里做了一点个人改动：**把口语复述换成写作概括，素材使用 TED。** 当前版本只保留“听 → 写 → 对照”。

## 怎么玩

粘贴英文原声的 TED 演讲链接，工具下载官方视频和英文字幕，按字幕句界整理成小片段。播放到段末自动停下，在旁边写一句自己的概括，再按需查看原文。

- 少于 **10 个词**的句子向后合并，再将少于 **10 秒**的片段向后合并；末尾短段并入前段，保留自然停顿。
- 左方向键重听当前段，连按回前段；右方向键进入下一段。输入框内仍用于移动光标。
- 写作和当前位置保存在当前浏览器；导入的视频、字幕保存在本机。清理浏览器站点数据会删除填写。

分段依据字幕和标点，边界不一定每次都自然。详细约定见 [素材处理规则](产品设计/13-素材处理与练习接入规则.md)。

## 相关理论

这些研究支持流程中的一些环节，并没有直接证明这个小工具的训练效果；以下论文也并非都由原视频直接引用。

- **主动提取**：先离开原稿，尝试回忆内容。Roediger 与 Karpicke（2006）研究发现，文章学习中的回忆练习可以改善延迟后的内容保留。[原始论文](https://learninglab.psych.purdue.edu/downloads/2006/2006_Roediger_Karpicke_PsychSci.pdf)
- **有益的困难**：尝试组织自己的表达可以增加提取要求，但困难需要适合当前能力，不是越痛苦越有效。Bjork 与 Bjork（2011）。[作者公开章节](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/11/Making-Things-Hard-on-Yourself-but-in-a-Good-Way-20111.pdf)
- **反馈**：尝试之后需要可靠信息来核对错误。Butler 与 Roediger（2008）的测试研究支持反馈的作用；这里用原文作参考，不自动给改述判分。[原始论文](https://link.springer.com/article/10.3758/MC.36.3.604)

原视频提到的《认知天性》原著 *Make It Stick*，作者是 Peter C. Brown、Henry L. Roediger III 和 Mark A. McDaniel。[官方作者页](https://www.makeitstick.com/meet-the-authors)

## 社区里类似的做法

目前找到的是具体讨论中的经验与分歧，不能据此说整个社区已经形成共识。

- [Language Lords 方法讨论](https://www.reddit.com/r/languagelearning/comments/qetv9v/thoughts_on_language_lords_method/)里有“看视频、自己复述、回看查缺口”的做法，也有人提醒 TED 对初学者可能太难，反复练同一材料可能枯燥，仍需要反馈。
- [语言学习者的经验分享](https://www.reddit.com/r/languagelearning/comments/1asxalk/the_people_here_who_learnt_a_language_and_is_now/)中，有人建议阅读后写总结、请他人核对，也有人分享大量输入与目标语字幕的帮助。这些个人经验适合提供尝试方向，不能当成效果证据。

所以这里保留“小段、自己写、再对照”的尝试，也不把字幕视为有害：[Mitterer 与 McQueen（2009）](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0007785)在陌生英语口音的实验中发现，目标语字幕可以帮助语音感知学习。

## 本机运行

需要 **Node.js 24 或更新版本**，以及能直接调用的 **FFmpeg / ffprobe**。下载源码后，在 `mvp` 文件夹运行：

```sh
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:4397](http://127.0.0.1:4397)，粘贴 TED 链接开始导入。Windows 完成首次安装与构建后，也可以双击根目录的 `启动练习.cmd`。

源码不附带视频和字幕，首次打开从空素材库开始。只支持有官方英文字幕、英文原声和 TED 自托管视频资源的单场演讲；TED 页面或资源变化时，导入可能需要跟着调整。视频与字幕版权归原权利人。

开发检查：在 `mvp` 中运行 `npm test`、`npm run check`。页面开发端口是 4398，默认连接 4397 的本机服务。
