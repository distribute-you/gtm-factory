/** The code of every script of the fictional world, by its `code` key (generated list; each file is plain code you can edit). */
import type { ScriptLibrary } from "@gtm-factory/core";
import s0 from "./rating/rating_pooled/v1";
import s1 from "./offer_described/offer_client/v1";
import s2 from "./audience_built/icp_client_states/v1";
import s3 from "./audience_built/icp_ai/v1";
import s4 from "./template_written/tpl_copywriter/v1";
import s5 from "./template_written/tpl_ai/v1";
import s6 from "./brand_context/ctx_short/v1";
import s7 from "./brand_context/ctx_full/v1";
import s8 from "./llm_completion/glm/v1";
import s9 from "./llm_completion/gemini_flash/v1";
import s10 from "./llm_completion/gemini_pro/v1";
import s11 from "./lead_found/src_filters/v1";
import s12 from "./lead_found/src_filters_30/v1";
import s13 from "./lead_found/src_signals/v1";
import s14 from "./lead_identified/id_email/v1";
import s15 from "./lead_identified/id_merge/v1";
import s16 from "./email_found/ef_pattern/v1";
import s17 from "./email_found/ef_lookup/v1";
import s18 from "./company_researched/cr_site/v1";
import s19 from "./company_researched/cr_deep/v1";
import s20 from "./message_written/wr_short/v1";
import s21 from "./message_written/wr_research/v1";
import s22 from "./message_queued/ce_now/v1";
import s23 from "./message_queued/ce_morning/v1";
import s24 from "./message_sent/mb_send/v1";
import s25 from "./reply_received/mb_replies/v1";
import s26 from "./reply_received/li_connect/v1";
import s27 from "./lead_interested/rj_ai/v1";
import s28 from "./lead_interested/crm_sync/v1";
import s29 from "./unsubscribed/mb_sync/v1";
import s30 from "./lead_interested/org_inbound/v1";
import s31 from "./follow_up_queued/fu_bump/v1";
import s32 from "./follow_up_queued/fu_angle/v1";
import s33 from "./reply_received/mb_fu_replies/v1";
import s34 from "./lead_visited/ad_search/v1";
import s35 from "./lead_visited/ad_social/v1";
import s36 from "./lead_interested/web_signup/v1";
import s37 from "./meeting_booked/bk_link/v1";
import s38 from "./meeting_booked/bk_slots/v1";
import s39 from "./meeting_booked/tb_rep/v1";
import s40 from "./meeting_attended/rm_email/v1";
import s41 from "./meeting_attended/rm_sms/v1";
import s42 from "./paid_client/cl_call/v1";
import s43 from "./connected_account/acc_connect/v1";
import s44 from "./reply_received/wa_message/v1";
import s45 from "./message_received/wa_inbox_personal/v1";
import s46 from "./message_received/wa_inbox_pro/v1";
import s47 from "./message_received/wa_inbox_agent/v1";
import s48 from "./welcomed/wa_welcome/v1";
import s49 from "./answered_by_you/answer_on_pro/v1";
import s50 from "./message_queued/ce_morning/v2";
import s51 from "./message_queued/ce_now/v2";
import s52 from "./follow_up_queued/fu_angle/v2";
import s53 from "./follow_up_queued/fu_bump/v2";
import s54 from "./reply_received/mb_replies/v2";
import s55 from "./reply_received/li_connect/v2";
import s56 from "./llm_completion/glm/v2";
import s57 from "./llm_completion/gemini_flash/v2";
import s58 from "./llm_completion/gemini_pro/v2";
import s59 from "./llm_completion/clients_claude/v1";
import s60 from "./llm_completion/clients_claude_first/v1";
import s61 from "./message_written/wr_short/v2";
import s62 from "./message_written/wr_research/v2";
import s63 from "./lead_interested/rj_ai/v2";
import s64 from "./reply_received/li_connect/v3";
import s65 from "./reply_received/wa_message/v2";
import s66 from "./follow_up_queued/fu_angle/v3";
import s67 from "./follow_up_queued/fu_bump/v3";

export const LIBRARY: ScriptLibrary = {
  "rating/rating_pooled/v1": s0,
  "offer_described/offer_client/v1": s1,
  "audience_built/icp_client_states/v1": s2,
  "audience_built/icp_ai/v1": s3,
  "template_written/tpl_copywriter/v1": s4,
  "template_written/tpl_ai/v1": s5,
  "brand_context/ctx_short/v1": s6,
  "brand_context/ctx_full/v1": s7,
  "llm_completion/glm/v1": s8,
  "llm_completion/gemini_flash/v1": s9,
  "llm_completion/gemini_pro/v1": s10,
  "lead_found/src_filters/v1": s11,
  "lead_found/src_filters_30/v1": s12,
  "lead_found/src_signals/v1": s13,
  "lead_identified/id_email/v1": s14,
  "lead_identified/id_merge/v1": s15,
  "email_found/ef_pattern/v1": s16,
  "email_found/ef_lookup/v1": s17,
  "company_researched/cr_site/v1": s18,
  "company_researched/cr_deep/v1": s19,
  "message_written/wr_short/v1": s20,
  "message_written/wr_research/v1": s21,
  "message_queued/ce_now/v1": s22,
  "message_queued/ce_morning/v1": s23,
  "message_sent/mb_send/v1": s24,
  "reply_received/mb_replies/v1": s25,
  "reply_received/li_connect/v1": s26,
  "lead_interested/rj_ai/v1": s27,
  "lead_interested/crm_sync/v1": s28,
  "unsubscribed/mb_sync/v1": s29,
  "lead_interested/org_inbound/v1": s30,
  "follow_up_queued/fu_bump/v1": s31,
  "follow_up_queued/fu_angle/v1": s32,
  "reply_received/mb_fu_replies/v1": s33,
  "lead_visited/ad_search/v1": s34,
  "lead_visited/ad_social/v1": s35,
  "lead_interested/web_signup/v1": s36,
  "meeting_booked/bk_link/v1": s37,
  "meeting_booked/bk_slots/v1": s38,
  "meeting_booked/tb_rep/v1": s39,
  "meeting_attended/rm_email/v1": s40,
  "meeting_attended/rm_sms/v1": s41,
  "paid_client/cl_call/v1": s42,
  "connected_account/acc_connect/v1": s43,
  "reply_received/wa_message/v1": s44,
  "message_received/wa_inbox_personal/v1": s45,
  "message_received/wa_inbox_pro/v1": s46,
  "message_received/wa_inbox_agent/v1": s47,
  "welcomed/wa_welcome/v1": s48,
  "answered_by_you/answer_on_pro/v1": s49,
  "message_queued/ce_morning/v2": s50,
  "message_queued/ce_now/v2": s51,
  "follow_up_queued/fu_angle/v2": s52,
  "follow_up_queued/fu_bump/v2": s53,
  "reply_received/mb_replies/v2": s54,
  "reply_received/li_connect/v2": s55,
  "llm_completion/glm/v2": s56,
  "llm_completion/gemini_flash/v2": s57,
  "llm_completion/gemini_pro/v2": s58,
  "llm_completion/clients_claude/v1": s59,
  "llm_completion/clients_claude_first/v1": s60,
  "message_written/wr_short/v2": s61,
  "message_written/wr_research/v2": s62,
  "lead_interested/rj_ai/v2": s63,
  "reply_received/li_connect/v3": s64,
  "reply_received/wa_message/v2": s65,
  "follow_up_queued/fu_angle/v3": s66,
  "follow_up_queued/fu_bump/v3": s67,
};

export { SOURCES } from "./sources";
