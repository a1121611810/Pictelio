// stripNovelCaptionHtml 单测（spec #585 / 票 #587；oracle = 2026-09-18 模拟器实测的真实
// caption 形态——含 <br /> 与日本语文本，非自洽 mock）
import { describe, expect, it } from 'vitest'
import { stripNovelCaptionHtml } from './novelCaption'

describe('stripNovelCaptionHtml（简介纯文本化）', () => {
  it('<br /> 转换行（真实响应形态：模拟器实测）', () => {
    expect(stripNovelCaptionHtml('祝看的开心<br /><br />"悲"')).toBe('祝看的开心\n\n"悲"')
  })

  it('剥除其余标签（<a>/<strong>/<span style>）', () => {
    expect(stripNovelCaptionHtml('<a href="x">链接</a>与<strong>加粗</strong>')).toBe('链接与加粗')
    expect(stripNovelCaptionHtml('<span style="color:red">红字</span>')).toBe('红字')
  })

  it('HTML 实体解码（&amp; 最后，避免二次解码）', () => {
    expect(stripNovelCaptionHtml('A &amp; B &lt;tag&gt; &quot;q&quot; &#39;p&#39;')).toBe('A & B <tag> "q" \'p\'')
  })

  it('纯文本原样透传 + 收尾 trim', () => {
    expect(stripNovelCaptionHtml('  普通简介  ')).toBe('普通简介')
  })

  it('空串恒空串', () => {
    expect(stripNovelCaptionHtml('')).toBe('')
  })
})
