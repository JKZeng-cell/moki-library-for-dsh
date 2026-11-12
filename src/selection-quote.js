// A quick action carries an immutable selection, independent of later focus or
// selection messages. Native input insertion preserves the user's existing draft.
export function insertSelectionQuote(request,input,actions,quote) {
  if(!request||!actions||input?.phase!=='plain')return null
  const text=quote(request.selection)
  if(!text)return {added:false}
  if(String(input.draft||'').replace(/^> ?/gm,'').includes(text))return {added:true}
  const added=Boolean(actions.insertQuote(text))
  if(added)actions.persistDraft()
  return {added}
}
