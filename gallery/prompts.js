// 插件里两个工作台的 prompt 生成。页面、复制、后台执行用的是同一份文本，
// 所以这里只做字符串拼接，不碰 DOM。模型在对话/后台按 skill 规范干活，完成后调用插件工具入库。
;(function () {
  const has = (v) => String(v == null ? '' : v).trim().length > 0
  const val = (v, fallback) => (has(v) ? String(v).trim() : fallback || '未填写')

  const PRECISION = {
    brief: '粗略搜索（只保留岗位、任期、履历等关键信息；不按任职阶段逐段回溯，公开活动只收最近 1—3 条）',
    full: '全面搜索（过往经历、去向、公开活动和发言都要；按任职阶段逐段回溯，信源尽量铺开、关键事实双源交叉）',
  }
  const precision = (p) => PRECISION[p === 'brief' ? 'brief' : 'full']

  // 检索矩阵：这份清单是「资料全不全」的关键。只搜姓名一定会漏。
  const MATRIX = [
    '【检索矩阵】下面每一类至少跑一轮，不要只搜姓名：',
    '1. 姓名 + 职务 / 单位 / 活动类型（调研、座谈、签约、致辞、主持、发布会、培训班）',
    '2. 现任与历任职务全称 + 地区（很多报道只写职务、不写姓名）',
    '3. 单位 + 年份 + 活动（从最早可确认的任职年份逐年到今年）',
    '4. 姓名 + 年份（逐年）',
    '5. 关联条线：宣传、网信、互联网行业党委、网络安全宣传周、数字经济 / 游戏电竞、普法、防汛、统战等',
    '6. 名单类文件：防汛指挥部、专项工作组、领导小组、普法协调小组、网信委成员名单',
    '7. 署名文章：区直机关党建、北京日报 / 前线 / 支部生活、学习强国、单位公众号',
    '8. 公众号与融媒体：北京号、区政府 / 融媒体中心、街道 / 园区、企业 / 协会公众号',
    '9. 行业活动与协会：ChinaJoy、DEAS、游戏工委、音数协、MGEA 等',
    '10. site: 限定政府域名，逐个站内搜索',
  ]

  // 元宝搜索：国内政务 / 党媒 / 公众号索引，能直接拿到公众号正文片段
  const YUANBAO = [
    '【元宝搜索】先用 character_profile_yuanbao_search 搜「姓名 + 地区 / 职务」「活动名 + 年份」「单位 + 年份」各一轮；它返回公众号、政府、党媒的结果卡片和正文片段（公众号卡片会带正文），能绕开 mp.weixin 的验证页。公众号正文来自元宝索引，可能是片段；引用前用官方同源版本核对。',
  ]

  // 微信风控：公众号原文经常返回验证页，不能当正文用
  const WECHAT = [
    '【公众号链接怎么处理】mp.weixin.qq.com 经常返回「环境异常 / 完成验证 / 去验证」或 /mp/wappoc_appmsgcaptcha 页面，这不是文章内容：',
    '- 先用 character_profile_yuanbao_search 搜公众号线索；再用 character_profile_wechat_search 按关键词 / 活动名 / 标题补标题、摘要、发布时间和公众号名。',
    '- 识别到上述验证特征，最多重试 1 次；仍失败就放弃该链接，不要反复抓同一个 URL。',
    '- 改用同源版本：区政府 / 区委官网、区委党校、北京组工网、北京号、区融媒体中心、部门官网、北京市政府网，以及主流媒体转载。',
    '- 搜索方法：拿文章标题做精确搜索，叠加 site:；或「活动名 + 日期 + 单位」。北京号版本不一定在 mp.weixin。',
    '- 公众号链接只作线索（标题、日期、发布号）；正文事实必须来自可访问的官方 / 党媒 / 北京号版本，或用户提供的原文。只有公众号、找不到同源版本时，这条活动不收，不要凭标题猜内容。',
  ]

  const FLOOR_PERSON_FULL = [
    '【全面搜索的入库下限】不达标会被插件工具拒绝入库，不要写完了就交：',
    '- 五章齐全；任职阶段 ≥ 2 个，按阶段分组、阶段内按时间倒序',
    '- 公开活动与发言 ≥ 12 条，每个阶段 ≥ 3 条；确实无记录的阶段写明「该阶段未见公开活动记录」',
    '- 独立信源 ≥ 10 个，其中政府 / 人大 / 政协 / 法院 / 检察院等官方域名 ≥ 3 个；同一篇文章的转载只算一个',
    '- 兼任职务逐个查：行业党委、党支部书记、专项小组、协会 / 学会 / 促进会、人大 / 政协等，每条注明证据',
    '- 现任职务给出「任职起始时点」：用最早一条可确认的公开报道倒推，注明是在任时点、不是任免文件日期',
    '- 署名文章、名单类、会议纪要都算记录；纯礼节性、单源自媒体的活动可以不收',
  ]

  const FLOOR_PERSON_BRIEF = [
    '【粗略搜索的入库下限】',
    '- 五章齐全；公开活动与发言 ≥ 3 条，信源 ≥ 3 个，官方域名 ≥ 1 个',
    '- 只跑矩阵第 1、2、4 类，加一次名单类检索即可；不逐阶段回溯，不扩年份',
  ]

  const FLOOR_INST_FULL = [
    '【全面搜索的入库下限】不达标会被插件工具拒绝入库：',
    '- 机构概况完整：全称、简称、隶属与层级、主要职能、领导班子、内设机构 / 下属单位',
    '- 主要人物 ≥ 3 位（一把手、分管副职、党组成员等），每人按 format-spec 五章齐全',
    '- 全档公开活动与发言 ≥ 8 条，信源 ≥ 8 个，官方域名 ≥ 2 个',
    '- 领导班子名单要列全，逐个给职务与分工；查不到的写「未公开」',
  ]

  const FLOOR_INST_BRIEF = [
    '【粗略搜索的入库下限】',
    '- 机构概况 + 领导班子名单与分工；主要人物 ≥ 2 位，每人至少岗位、任期、履历要点',
    '- 全档公开活动 ≥ 3 条，信源 ≥ 3 个，官方域名 ≥ 1 个',
  ]

  function research(f = {}) {
    const mode = f.mode === 'institution' ? 'institution' : 'person'
    const brief = f.precision === 'brief'
    const lines = []

    if (mode === 'institution') {
      lines.push(
        '/person-dossier 按「人物资料搜集」（person-dossier）skill 的规范，帮我做一份机构资料：以机构为主，覆盖机构本身和其中主要人物。',
        '',
        '【对象】',
        '- 类型：机构',
        `- 机构名称：${val(f.org, '未填写')}`,
        `- 检索精度：${precision(f.precision)}`,
        '- 旧版档案：开始前先调用 character_profile_read_dossier（name 填机构名称）查资料库有没有旧档；有就记下 id，保存时传 id 覆盖，不要重复建一份。',
        '',
        ...YUANBAO,
        '',
        ...MATRIX,
        '',
        ...(brief ? FLOOR_INST_BRIEF : FLOOR_INST_FULL),
        '',
        '【交付要求】',
        '1. 文档开头先写「机构概况」：机构全称与规范简称、隶属关系与层级、主要职能、领导班子构成、内设机构 / 下属单位概览。层级按「省级 / 地市级 / 区县级」判断：省、自治区、直辖市为省级（北京市级 = 省级）；地级市、副省级市为地市级；市辖区、县为区县级。',
        '2. 然后按 skill 的 references/format-spec.md，为该机构的主要人物逐人建档（一把手、分管副职、党组成员等，通常 3—5 人，按职务层级排序），每人五章齐全：基本信息、现任职务、职务任免、履历、公开活动与发言。',
        brief
          ? '3. 粗略搜索：机构概况写到职能和领导班子名单即可；每位人物只保留岗位、任期、履历要点，公开活动只收最近 1—3 条，不逐阶段回溯，不扩展信源。'
          : '3. 全面搜索：机构概况写清职能、内设机构与下属单位；每位人物按任职阶段逐段回溯公开活动与发言，每阶段尽量 3—8 条，信源尽量铺开。',
        '4. 只查公开可访问的渠道，不绕过访问限制，不采集隐私信息；关键事实要有双源或一级官方信源，日期按「页面发布日 / URL 日期 / 正文时间」三重核验；确认不了的写「未公开」，不写推测。',
        `5. 完成后调用 character_profile_save_dossier 保存：name 填机构名称，kind 填 institution，precision 填 ${brief ? 'brief' : 'full'}，region 填所在地区，department 填机构全称，level 填归一后的层级，tags 填主要人物姓名，summary 用一句话概括机构职能与领导班子，content 放完整正文。`,
        '6. 工具返回「未保存：覆盖度不足」时，按它列出的缺口继续检索补齐，再调用一次（同一个 id）；确实多轮检索仍补不齐，才传 force: true 并在 note 里说明查过哪些渠道。',
        '7. 保存后告诉我已存到「人物资料库」，并说明收录了哪几位主要人物、覆盖了多少条活动和信源。',
      )
      return lines.join('\n')
    }

    lines.push(
      '/person-dossier 按「人物资料搜集」（person-dossier）skill 的规范，帮我做一份人物资料档案。',
      '',
      '【对象】',
      '- 类型：人物',
      `- 姓名：${val(f.name, '未填写（先按地区 / 单位检索这个岗位的现任负责人，确认姓名后告诉我）')}`,
      `- 地区：${val(f.region, '未填写')}`,
      `- 部门／单位：${val(f.department, '未填写')}`,
      `- 检索精度：${precision(f.precision)}`,
      '- 旧版档案：开始前先调用 character_profile_read_dossier（name 填对象姓名）查资料库有没有旧档；有就记下 id，保存时传 id 覆盖，不要重复建一份。',
      '',
      ...YUANBAO,
      '',
      ...MATRIX,
      '',
      ...WECHAT,
      '',
      ...(brief ? FLOOR_PERSON_BRIEF : FLOOR_PERSON_FULL),
      '',
      '【要求】',
      brief
        ? '1. 先建履历和任免（含全部任职单位、起止时间），公开活动只收最近 1—3 条有实质内容的；不按任职阶段逐段回溯，也不做跨年扩展检索。'
        : '1. 先建完整履历（含全部任职单位、层级、起止时间），再按任职阶段逐段检索公开活动与发言；每个阶段都要检索，重要岗位多查一轮。',
      '2. 只查公开可访问的渠道，不绕过任何访问限制，不采集隐私信息；关键事实要有双源或一级官方信源；日期按「页面发布日 / URL 日期 / 正文时间」三重核验；确认不了的写「未公开」，不写「待核实」「推测」。',
      '3. 严格按 skill 的 references/format-spec.md 输出：基本信息、现任职务、职务任免、履历、公开活动与发言五章齐全；只陈述事实，不写研判、建议、评价。',
      '4. 分管工作优先引用分工文件；没有文件时，可以引用本人署名文章、单位公众号里对自己的职责表述，注明出处，不得用活动频次推断。',
      `5. 完成后调用 character_profile_save_dossier 保存整份 Markdown（kind 填 person，precision 填 ${brief ? 'brief' : 'full'}；name / region / department / level / role / tags / content / sources 都填；层级归一到 省级 / 地市级 / 区县级，直辖市按省级算：北京市级 = 省级，北京市朝阳区 = 区县级），然后告诉我已存到「人物资料库」。`,
      '6. 工具返回「未保存：覆盖度不足」时，按它列出的缺口继续检索补齐，再调用一次（同一个 id）；确实多轮检索仍补不齐，才传 force: true 并在 note 里说明查过哪些渠道、为什么补不齐。',
      '7. 同名重名、或公开信息不足以支撑一份完整档案时，先说明卡在哪一步，不要硬凑。',
    )
    return lines.join('\n')
  }

  function card(f = {}) {
    const mode = f.mode || 'name'
    const name = val(f.name, '未填写')
    const material = mode === 'material' && has(f.material) ? String(f.material).trim().slice(0, 20000) : ''
    const source =
      mode === 'dossier' && f.dossierId
        ? `「人物资料库」里的档案 ${f.dossierId}：先调用 character_profile_read_dossier 读取全文，按里面的公开活动与发言编码`
        : mode === 'material'
          ? '上面【资料】里我贴的正文（先据此整理事实，不够的地方再补公开检索）'
          : '公开检索。资料库里没有这个人的档案时，先用「人物资料搜集」（person-dossier）skill 按规范补一份完整档案（完成后调用 character_profile_save_dossier 入库），再按「人物画像卡」skill 出卡；资料库里已有的话先调用 character_profile_read_dossier 读取，不要重复检索'

    const lines = []
    if (mode === 'material') {
      lines.push(
        '/governance-portrait 按「人物画像卡」skill 的规范，根据我贴的资料做一张 1080×1440 的克莱因蓝人物画像卡。',
        '',
        '【资料】',
        material || '（资料为空）',
        '',
        '【对象】',
        '- 资料里要画像的人物：由你从资料中识别（通常是最核心、出现最多的那位）；姓名、单位、职务、观察期都从资料里取，不要另填，也不要凭岗位想象。',
        `- 资料：${source}`,
        '',
      )
    } else {
      lines.push(
        `/governance-portrait 按「人物画像卡」skill 的规范，为【${name}】做一张 1080×1440 的克莱因蓝人物画像卡。`,
        '',
        '【对象】',
        `- 姓名：${name}`,
        `- 地区／单位：${val(f.region, '未填写')}${has(f.department) ? ' · ' + String(f.department).trim() : ''}`,
        `- 当前职务：${val(f.role, '未填写（按公开信息确认）')}`,
        `- 观察期：${val(f.period, '未填写（用最近 12 个月的公开活动）')}`,
        `- 资料：${source}`,
        '',
      )
      if (mode === 'name' && !has(f.region) && !has(f.department)) {
        lines.push('资料库里可能没有这个人：如果检索后仍无法确认身份，先告诉我重名情况或缺少哪些公开信息，不要凭岗位想象出卡。', '')
      }
    }
    lines.push(
      '【要求】',
      '1. 先建事件底稿：每条留事件编号、日期、身份、事项、本人动作、具体对象、出处、归因、两轴分及理由；多个转载合并，同一推进过程合成一条证据链。',
      '2. 只据公开信息编码，不按职级、学历、地点、行业关键词或象限反推权限与人格；证据不足就标「证据不足」，不造点。',
      '2b. 公众号（mp.weixin.qq.com）返回「环境异常 / 去验证 / wappoc_appmsgcaptcha」时，最多重试 1 次就放弃；先用 character_profile_yuanbao_search 搜标题 / 活动 / 公众号线索，再用 character_profile_wechat_search 补标题 / 摘要，最后改用区政府 / 区委党校 / 北京组工网 / 北京号 / 融媒体等可访问的同源版本，不要卡在验证页。',
      '3. 卡面以 skill 的 assets/layout-example.html 作视觉参照，但必须替换全部内容；固定 1080×1440，克莱因蓝外框、白色主体；右上角只写「地区 / PROFILE」，PROFILE 后面不加编号；四象限类型说明用固定文案，恰好两行。',
      '4. 卡面写成单文件 HTML（内联样式，中文字体用本机有的），调用 character_profile_save_card 保存：html 传完整 HTML，同时填 name / title / subtitle / type / confidence / stars / region / period / dossierId。工具会渲染 PNG、存进「人物画像库」并让页面弹出预览，不要自己截图。',
      '5. 存好后告诉我：已存到「人物画像库」，并附关键依据（可点击的原文链接）。',
    )
    return lines.join('\n')
  }

  function importDoc({ text, name = '', filename = '', existingId = '' }) {
    return [
      '/person-dossier 按「人物资料搜集」（person-dossier）skill 的格式，把下面这份用户提供的材料整理成一份档案并保存。',
      '',
      `【材料来源】${filename || '用户粘贴'}`,
      `【已知姓名】${name || '未填，由你从材料识别'}`,
      ...(existingId ? [`【已有同名档案】id=${existingId}；保存时传这个 id 覆盖，不要重复新建`] : []),
      '【材料原文】',
      '"""',
      String(text || '').slice(0, 60000),
      '"""',
      '',
      '【整理规则】',
      '1. 只使用材料里的事实，不补充、不检索、不推断；材料没有的字段写「未公开」。',
      '2. 识别姓名、地区、单位、层级、职务；层级按 省级 / 地市级 / 区县级 / 其他，直辖市按省级（北京市级 = 省级，北京市朝阳区 = 区县级）。',
      '3. 按 skill 的 references/format-spec.md 输出五章：基本信息、现任职务、职务任免、履历、公开活动与发言；材料里的日期、引语、表格尽量保留原文。',
      '4. 材料是机构材料时加「机构概况」，kind=institution；否则 kind=person。',
      '5. 调用 character_profile_save_dossier 保存：source 填 user（材料由用户提供，跳过覆盖度门槛），name / region / department / level / role / tags / content 都填，origin 工具会自动记为上传。',
      '6. 如果工具返回覆盖度不足，说明 source 没传上：重新调用时补 source: user，不要用 force 硬写，也不要为了凑数编造活动。',
      '7. 保存后回复：存了谁、id、哪些字段是「未公开」。',
    ].join('\n')
  }

  window.PS_PROMPTS = { research, card, importDoc }
})()
