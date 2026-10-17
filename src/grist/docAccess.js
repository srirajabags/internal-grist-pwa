// Doc owners are exempt from the "nobody acknowledges their own entry" rule, and
// that means owners of the Grist doc, not the OWNER role in Team: the access
// rules test user.Access, and the two lists are not the same people. Asked with
// the same headers as everything else, so an impersonated session answers for
// whoever is being impersonated -- which is who Grist will check.
export const fetchIsDocOwner = async (docId, getHeaders, getUrl) => {
    try {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${docId}`), { headers });
        if (!res.ok) return false;
        const doc = await res.json();
        return doc?.access === 'owners';
    } catch {
        return false;
    }
};
