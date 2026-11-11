"""Support for dnsdumpster.com."""
import re

import requests


def dnsdumpster(domain, output_dir):
    """Query dnsdumpster.com safely with exception handling."""
    try:
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })
        response = session.get('https://dnsdumpster.com/', timeout=8).text
        match = re.search(r'name=\"csrfmiddlewaretoken\" value=\"(.*?)\"', response)
        if not match:
            return
        csrf_token = match.group(1)

        cookies = {'csrftoken': csrf_token}
        headers = {'Referer': 'https://dnsdumpster.com/'}
        data = {'csrfmiddlewaretoken': csrf_token, 'targetip': domain}
        session.post('https://dnsdumpster.com/', cookies=cookies, data=data, headers=headers, timeout=10)

        image = session.get('https://dnsdumpster.com/static/map/%s.png' % domain, timeout=8)
        if image.status_code == 200 and len(image.content) > 100:
            with open('%s/%s.png' % (output_dir, domain), 'wb') as f:
                f.write(image.content)
    except Exception:
        # Ignore external third-party lookup failures gracefully
        pass
